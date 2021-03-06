import { isURL } from "validator";
import { Constants, DurableOrchestrationStatus, HttpManagementPayload, IFunctionContext, IHttpRequest,
    IHttpResponse, IRequest, OrchestrationClientInputData, OrchestrationRuntimeStatus, Utils, WebhookClient,
} from "./classes";

/**
 * Returns an OrchestrationClient instance.
 * @param context The context object of the Azure function whose body
 *  calls this method.
 * @example Get an orchestration client instance
 * ```javascript
 * const df = require("durable-functions");
 *
 * module.exports = df.orchestrator(function*(context) {
 *     const client = df.getClient(context);
 *     const instanceId = await client.startNew(req.params.functionName, undefined, req.body);
 *
 *     return client.createCheckStatusResponse(instanceId);
 * });
 * ```
 */
export function getClient(context: unknown): DurableOrchestrationClient {
    return new DurableOrchestrationClient(context);
}

/**
 * Client for starting, querying, terminating and raising events to
 * orchestration instances.
 */
export class DurableOrchestrationClient {
    /**
     * The name of the task hub configured on this orchestration client
     * instance.
     */
    public taskHubName: string;

    private readonly eventNamePlaceholder = "{eventName}";
    private readonly functionNamePlaceholder = "{functionName}";
    private readonly instanceIdPlaceholder = "[/{instanceId}]";
    private readonly reasonPlaceholder = "{text}";

    private readonly createdTimeFromQueryKey = "createdTimeFrom";
    private readonly createdTimeToQueryKey = "createdTimeTo";
    private readonly runtimeStatusQuerykey = "runtimeStats";
    private readonly showHistoryQueryKey = "showHistory";
    private readonly showHistoryOutputQueryKey = "showHistoryOutput";

    private clientData: OrchestrationClientInputData;
    private webhookClient: WebhookClient;
    private urlValidationOptions: ValidatorJS.IsURLOptions = {
        protocols: ["http", "https"],
        require_tld: false,
        require_protocol: true,
        require_valid_protocol: true,
    };

    /**
     * @param context The context object of the Azure function whose body
     * calls this constructor.
     */
    constructor(private context: unknown) {
        if (!context) {
            throw new TypeError(`context: Expected context object but got ${typeof context}`);
        }

        this.clientData = this.getClientData();
        this.taskHubName = this.clientData.taskHubName;
        this.webhookClient = new WebhookClient();
    }

    /**
     * Creates an HTTP response that is useful for checking the status of the
     * specified instance.
     * @param request The HTTP request that triggered the current orchestration
     *  instance.
     * @param instanceId The ID of the orchestration instance to check.
     * @returns An HTTP 202 response with a Location header and a payload
     *  containing instance management URLs.
     */
    public createCheckStatusResponse(request: IHttpRequest | IRequest, instanceId: string): IHttpResponse {
        const httpManagementPayload = this.getClientResponseLinks(request, instanceId);

        return {
            status: 202,
            body: httpManagementPayload,
            headers: {
                "Content-Type": "application/json",
                "Location": httpManagementPayload.statusQueryGetUri,
                "Retry-After": 10,
            },
        };
    }

    /**
     * Creates an [[HttpManagementPayload]] object that contains instance
     * management HTTP endpoints.
     * @param instanceId The ID of the orchestration instance to check.
     */
    public createHttpManagementPayload(instanceId: string): HttpManagementPayload {
        return this.getClientResponseLinks(undefined, instanceId);
    }

    /**
     * Gets the status of the specified orchestration instance.
     * @param instanceId The ID of the orchestration instance to query.
     * @param showHistory Boolean marker for including execution history in the
     *  response.
     * @param showHistoryOutput Boolean marker for including input and output
     *  in the execution history response.
     */
    public async getStatus(
        instanceId: string,
        showHistory?: boolean,
        showHistoryOutput?: boolean,
        ): Promise<DurableOrchestrationStatus> {
        const template = this.clientData.managementUrls.statusQueryGetUri;
        const idPlacholder = this.clientData.managementUrls.id;

        let webhookUrl = template.replace(idPlacholder, instanceId);
        if (showHistory) {
            webhookUrl += `&${this.showHistoryQueryKey}=${showHistory}`;
        }
        if (showHistoryOutput) {
            webhookUrl += `&${this.showHistoryOutputQueryKey}=${showHistoryOutput}`;
        }

        const res = await this.webhookClient.get(new URL(webhookUrl));
        switch (res.status) {
            case 200: // instance completed
            case 202: // instance in progress
            case 400: // instance failed or terminated
            case 404: // instance not found or pending
            case 500: // instance failed with unhandled exception
                return res.body as DurableOrchestrationStatus;
            default:
                throw new Error(`Webhook returned unrecognized status ${res.status}: ${res.body}`);
        }
    }

    /**
     * Gets the status of all orchestration instances.
     */
    public async getStatusAll(): Promise<DurableOrchestrationStatus[]> {
        // omit instanceId to get status for all instances
        const idPlaceholder = this.clientData.managementUrls.id;
        const url = this.clientData.managementUrls.statusQueryGetUri
            .replace(idPlaceholder, "");

        const res = await this.webhookClient.get(new URL(url));
        return res.body as DurableOrchestrationStatus[];
    }

    /**
     * Gets the status of all orchestration instances that match the specified
     * conditions.
     * @param createdTimeFrom Return orchestration instances which were created
     *  after this Date.
     * @param createdTimeTo Return orchestration instances which were created
     *  before this DateTime.
     * @param runtimeStatus Return orchestration instances which match any of
     *  the runtimeStatus values in this array.
     */
    public async getStatusBy(
        createdTimeFrom: Date,
        createdTimeTo: Date,
        runtimeStatus: OrchestrationRuntimeStatus[],
        ): Promise<DurableOrchestrationStatus[]> {
        const idPlaceholder = this.clientData.managementUrls.id;
        let url = this.clientData.managementUrls.statusQueryGetUri
            .replace(idPlaceholder, "");

        if (createdTimeFrom) {
            url += `&${this.createdTimeFromQueryKey}=${createdTimeFrom.toISOString()}`;
        }

        if (createdTimeTo) {
            url += `&${this.createdTimeToQueryKey}=${createdTimeTo.toISOString()}`;
        }

        if (runtimeStatus && runtimeStatus.length > 0) {
            const statusesString = runtimeStatus
                .map((value) => value.toString())
                .reduce((acc, curr, i, arr) => {
                    return acc + (i > 0 ? "," : "") + curr;
            });

            url += `&${this.runtimeStatusQuerykey}=${statusesString}`;
        }

        const res = await this.webhookClient.get(new URL(url));
        if (res.status > 202) {
            throw new Error(`Webhook returned status code ${res.status}: ${res.body}`);
        }   // TODO: Make this better.. message and conditional
        return res.body as DurableOrchestrationStatus[];
    }

    /**
     * Sends an event notification message to a waiting orchestration instance.
     * @param instanceId The ID of the orchestration instance that will handl
     *  the event.
     * @param eventName The name of the event.
     * @param eventData The JSON-serializeable data associated with the event.
     * @param taskHubName The TaskHubName of the orchestration that will handle
     *  the event.
     * @param connectionName The name of the connection string associated with
     *  `taskHubName.`
     * @returns A promise that resolves when the event notification message has
     *  been enqueued.
     *
     * In order to handle the event, the target orchestration instance must be
     * waiting for an event named `eventName` using
     * [[waitForExternalEvent]].
     *
     * If the specified instance is not found or not running, this operation
     * will have no effect.
     */
    public async raiseEvent(
        instanceId: string,
        eventName: string,
        eventData: unknown,
        taskHubName?: string,
        connectionName?: string,
        ): Promise<void> {
        if (!eventName) {
            throw new Error("eventName must be a valid string.");
        }

        const idPlaceholder = this.clientData.managementUrls.id;
        let url = this.clientData.managementUrls.sendEventPostUri
            .replace(idPlaceholder, instanceId)
            .replace(this.eventNamePlaceholder, eventName);

        if (taskHubName) {
            url = url.replace(this.clientData.taskHubName, taskHubName);
        }

        if (connectionName) {
            url = url.replace(/(connection=)([\w]+)/gi, "$1" + connectionName);
        }

        const res = await this.webhookClient.post(new URL(url), eventData);
        switch (res.status) {
            case 202: // event acccepted
            case 410: // instance completed or failed
                return;
            case 404:
                throw new Error(`No instance with ID '${instanceId}' found.`);
            case 400:
                throw new Error("Only application/json request content is supported");
            default:
                throw new Error(`Webhook returned unrecognized status code ${res.status}: ${res.body}`);
        }
    }

    /**
     * Rewinds the specified failed orchestration instance with a reason.
     * @param instanceId The ID of the orchestration instance to rewind.
     * @param reason The reason for rewinding the orchestration instance.
     * @returns A promise that resolves when the rewind message is enqueued.
     *
     * This feature is currently in preview.
     */
    public async rewind(instanceId: string, reason: string): Promise<void> {
        const idPlaceholder = this.clientData.managementUrls.id;
        const url = this.clientData.managementUrls.rewindPostUri
            .replace(idPlaceholder, instanceId)
            .replace(this.reasonPlaceholder, reason);

        const res = await this.webhookClient.post(new URL(url));
        switch (res.status) {
            case 202:
                return;
            case 404:
                throw new Error(`No instance with ID '${instanceId}' found.`);
            case 410:
                throw new Error(`The rewind operation is only supported on failed orchestration instances.`);
            default:
                throw new Error(`Webhook returned unrecognized status code ${res.status}: ${res.body}`);
        }
    }

    /**
     * Starts a new instance of the specified orchestrator function.
     *
     * If an orchestration instance with the specified ID already exists, the
     * existing instance will be silently replaced by this new instance.
     * @param orchestratorFunctionName The name of the orchestrator function to
     *  start.
     * @param instanceId The ID to use for the new orchestration instance. If
     *  no instanceId is specified, the Durable Functions extension will
     *  generate a random GUID (recommended).
     * @param input JSON-serializeable input value for the orchestrator
     *  function.
     * @returns The ID of the new orchestration instance.
     */
    public async startNew(orchestratorFunctionName: string, instanceId?: string, input?: unknown): Promise<string> {
        if (!orchestratorFunctionName) {
            throw new Error("orchestratorFunctionName must be a valid string.");
        }

        let url = this.clientData.creationUrls.createNewInstancePostUri;
        url = url
            .replace(this.functionNamePlaceholder, orchestratorFunctionName)
            .replace(this.instanceIdPlaceholder, (instanceId ? `/${instanceId}` : ""));

        const res = await this.webhookClient.post(new URL(url), input);
        if (res.status > 202) {
            throw new Error(res.body as string);
        } else if (res.body) {
            return (res.body as HttpManagementPayload).id;
        }
    }

    /**
     * Terminates a running orchestration instance.
     * @param instanceId The ID of the orchestration instance to terminate.
     * @param reason The reason for terminating the orchestration instance.
     * @returns A promise that resolves when the terminate message is enqueued.
     *
     * Terminating an orchestration instance has no effect on any in-flight
     * activity function executions or sub-orchestrations that were started
     * by the current orchestration instance.
     */
    public async terminate(instanceId: string, reason: string): Promise<void> {
        const idPlaceholder = this.clientData.managementUrls.id;
        const url = this.clientData.managementUrls.terminatePostUri
            .replace(idPlaceholder, instanceId)
            .replace(this.reasonPlaceholder, reason);

        const res = await this.webhookClient.post(new URL(url));
        switch (res.status) {
            case 202: // terminate accepted
            case 410: // instance completed or failed
                return;
            case 404:
                throw new Error(`No instance with ID '${instanceId}' found.`);
            default:
                throw new Error(`Webhook returned unrecognized status code ${res.status}: ${res.body}`);
        }
    }

    /**
     * Creates an HTTP response which either contains a payload of management
     * URLs for a non-completed instance or contains the payload containing
     * the output of the completed orchestration.
     *
     * If the orchestration does not complete within the specified timeout,
     * then the HTTP response will be identical to that of
     * [[createCheckStatusResponse]].
     *
     * @param request The HTTP request that triggered the current function.
     * @param instanceId The unique ID of the instance to check.
     * @param timeoutInMilliseconds Total allowed timeout for output from the
     *  durable function. The default value is 10 seconds.
     * @param retryIntervalInMilliseconds The timeout between checks for output
     *  from the durable function. The default value is 1 second.
     */
    public async waitForCompletionOrCreateCheckStatusResponse(
        request: IRequest,
        instanceId: string,
        timeoutInMilliseconds: number = 10000,
        retryIntervalInMilliseconds: number = 1000,
        ): Promise<IHttpResponse> {
        if (retryIntervalInMilliseconds > timeoutInMilliseconds) {
            throw new Error(`Total timeout ${timeoutInMilliseconds} (ms) should be bigger than retry timeout ${retryIntervalInMilliseconds} (ms)`); // tslint:disable-line max-line-length
        }

        const hrStart = process.hrtime();
        while (true) {
            const status = await this.getStatus(instanceId);

            if (status) {
                switch (status.runtimeStatus) {
                    case OrchestrationRuntimeStatus.Completed:
                        return this.createHttpResponse(200, status.output);
                    case OrchestrationRuntimeStatus.Canceled:
                    case OrchestrationRuntimeStatus.Terminated:
                        return this.createHttpResponse(200, status);
                    case OrchestrationRuntimeStatus.Failed:
                        return this.createHttpResponse(500, status);
                }
            }

            const hrElapsed = process.hrtime(hrStart);
            const hrElapsedMilliseconds = Utils.getHrMilliseconds(hrElapsed);

            if (hrElapsedMilliseconds < timeoutInMilliseconds) {
                const remainingTime = timeoutInMilliseconds - hrElapsedMilliseconds;
                await Utils.sleep(remainingTime > retryIntervalInMilliseconds
                    ? retryIntervalInMilliseconds
                    : remainingTime);
            } else {
                return this.createCheckStatusResponse(request, instanceId);
            }
        }
    }

    private createHttpResponse(statusCode: number, body: unknown): IHttpResponse {
        const bodyAsJson = JSON.stringify(body);
        return {
            status: statusCode,
            body: bodyAsJson,
            headers: {
                "Content-Type": "application/json",
                "Content-Length": bodyAsJson !== undefined ? bodyAsJson.length : 0,
            },
        };
    }

    private getClientData(): OrchestrationClientInputData {
        const matchingInstances = Utils.getInstancesOf<OrchestrationClientInputData>(
            (this.context as IFunctionContext).bindings,
            new OrchestrationClientInputData(undefined, undefined, undefined));

        if (!matchingInstances || matchingInstances.length === 0) {
            throw new Error(Constants.OrchestrationClientNoBindingFoundMessage);
        }

        return matchingInstances[0];
    }

    private getClientResponseLinks(request: IHttpRequest | IRequest, instanceId: string): HttpManagementPayload {
        const payload = { ...this.clientData.managementUrls };

        (Object.keys(payload) as Array<(keyof HttpManagementPayload)>).forEach((key) => {
            if (this.hasValidRequestUrl(request) && isURL(payload[key], this.urlValidationOptions)) {
                const requestUrl = new URL((request as IRequest).url || (request as IHttpRequest).http.url);
                const dataUrl = new URL(payload[key]);
                payload[key] = payload[key].replace(dataUrl.origin, requestUrl.origin);
            }

            payload[key] = payload[key].replace(this.clientData.managementUrls.id, instanceId);
        });

        return payload;
    }

    private hasValidRequestUrl(request: IHttpRequest | IRequest): boolean {
        const isIRequest = request !== undefined && (request as IRequest).url !== undefined;
        const isIHttpRequest = request !== undefined && (request as IHttpRequest).http !== undefined;
        return isIRequest || isIHttpRequest && (request as IHttpRequest).http.url !== undefined;
    }
}
