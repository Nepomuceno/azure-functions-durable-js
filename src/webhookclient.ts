import http = require("http");
import https = require("https");
import { IHttpResponse } from "./classes";

/** @hidden */
export class WebhookClient {
    public get(url: URL, timeoutInMilliseconds?: number): Promise<IHttpResponse> {
        return this.callWebhook(url, "GET", undefined, timeoutInMilliseconds);
    }

    public post(url: URL, input?: unknown, timeoutInMilliseconds?: number): Promise<IHttpResponse> {
        return this.callWebhook(url, "POST", input, timeoutInMilliseconds);
    }

    private callWebhook(
        url: URL,
        httpMethod: string,
        input?: unknown,
        timeoutInMilliseconds?: number,
        ): Promise<IHttpResponse> {
        return new Promise((resolve, reject) => {
            const requestData = JSON.stringify(input);

            const options: IRequestOptions = {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: httpMethod,
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": input !== undefined ? requestData.length : 0,
                },
            };

            if (url.port) {
                options.port = url.port;
            }

            if (timeoutInMilliseconds) {
                options.timeout = timeoutInMilliseconds + 500;
            }

            let requestModule: unknown;
            switch (url.protocol) {
                case "http:":
                    requestModule = http;
                    break;
                case "https:":
                    requestModule = https;
                    break;
                default:
                    throw new Error(`Unrecognized request protocol: ${url.protocol}. Only http: and https: are accepted.`); // tslint:disable-line max-line-length
            }

            const req = (requestModule as IModule).request(options, (res: http.IncomingMessage) => {
                let body = "";
                res.setEncoding("utf8");

                res.on("data", (data) => {
                    body += data;
                });

                res.on("end", () => {
                    const bodyObj = JSON.parse(body);
                    const responseObj = {
                        status: res.statusCode,
                        body: bodyObj,
                        headers: res.headers,
                    };
                    resolve(responseObj);
                });
            });

            req.on("error", (error: Error) => {
                reject(error);
            });

            if (httpMethod === "POST" && requestData) {
                req.write(requestData);
            }
            req.end();
        });
    }
}

/** @hidden */
interface IModule {
    request: IRequest;
}

/** @hidden */
interface IRequestHandler {
    on: IOn;
    write: IWrite;
    end: IEnd;
}

/** @hidden */
interface IRequestOptions {
    hostname: string;
    path: string;
    method: string;
    headers: {
        [key: string]: unknown;
    };
    port?: string;
    timeout?: number;
}

/** @hidden */
type IRequest = (options: object, callback: unknown) => IRequestHandler; // TODO: define callback as function
/** @hidden */
type IOn = (event: string, callback: unknown) => void;
/** @hidden */
type IWrite = (data: unknown) => void;
/** @hidden */
type IEnd = () => void;
