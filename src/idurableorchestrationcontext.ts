import { ITaskMethods, RetryOptions, Task, TimerTask } from "./classes";

/**
 * Parameter data for orchestration bindings that can be used to schedule
 * function-based activities.
 */
export interface IDurableOrchestrationContext {
    /**
     * The ID of the current orchestration instance.
     *
     * The instance ID is generated and fixed when the orchestrator function is
     * scheduled. It can be either auto-generated, in which case it is
     * formatted as a GUID, or it can be user-specified with any format.
     */
    instanceId: string;

    /**
     * Gets a value indicating whether the orchestrator function is currently
     * replaying itself.
     *
     * This property is useful when there is logic that needs to run only when
     * the orchestrator function is _not_ replaying. For example, certain types
     * of application logging may become too noisy when duplicated as part of
     * orchestrator function replay. The orchestrator code could check to see
     * whether the function is being replayed and then issue the log statements
     * when this value is `false`.
     */
    isReplaying: boolean;

    /**
     * The ID of the parent orchestration of the current sub-orchestration
     * instance. The value will be available only in sub-orchestrations.
     *
     * The parent instance ID is generated and fixed when the parent
     * orchestrator function is scheduled. It can be either auto-generated, in
     * which case it is formatted as a GUID, or it can be user-specified with
     * any format.
     */
    parentInstanceId: string;

    /**
     * Gets the current date/time in a way that is safe for use by orchestrator
     * functions.
     *
     * This date/time value is derived from the orchestration history. It
     * always returns the same value at specific points in the orchestrator
     * function code, making it deterministic and safe for replay.
     */
    currentUtcDateTime: Date;

    /**
     * Schedules an activity function named `name` for execution.
     *
     * @param name The name of the activity function to call.
     * @param input The JSON-serializable input to pass to the activity
     * function.
     * @returns A Durable Task that completes when the called activity
     * function completes or fails.
     */
    callActivity: (name: string, input?: unknown) => Task;

    /**
     * Schedules an activity function named `name` for execution with
     * retry options.
     *
     * @param name The name of the activity function to call.
     * @param retryOptions The retry options for the activity function.
     * @param input The JSON-serializable input to pass to the activity
     * function.
     */
    callActivityWithRetry: (name: string, retryOptions: RetryOptions, input?: unknown) => Task;

    /**
     * Schedules an orchestration function named `name` for execution.
     *
     * @param name The name of the orchestrator function to call.
     * @param input The JSON-serializable input to pass to the orchestrator
     * function.
     * @param instanceId A unique ID to use for the sub-orchestration instance.
     * If `instanceId` is not specified, the extension will generate an id in
     * the format `<calling orchestrator instance ID>:<#>`
     */
    callSubOrchestrator: (name: string, input?: unknown, instanceId?: string) => Task;

    /**
     * Schedules an orchestrator function named `name` for execution with retry
     * options.
     *
     * @param name The name of the orchestrator function to call.
     * @param retryOptions The retry options for the orchestrator function.
     * @param input The JSON-serializable input to pass to the orchestrator
     * function.
     * @param instanceId A unique ID to use for the sub-orchestration instance.
     */
    callSubOrchestratorWithRetry: (
        name: string,
        retryOptions: RetryOptions,
        input?: unknown,
        instanceId?: string) => Task;

    /**
     * Restarts the orchestration by clearing its history.
     *
     * @param The JSON-serializable data to re-initialize the instance with.
     */
    continueAsNew: (input: unknown) => Task;

    /**
     * Creates a durable timer that expires at a specified time.
     *
     * All durable timers created using this method must either expire or be
     * cancelled using [[TimerTask]].[[cancel]] before the orchestrator
     * function completes. Otherwise, the underlying framework will keep the
     * instance alive until the timer expires.
     *
     * Timers currently cannot be scheduled further than 7 days into the
     * future.
     *
     * @param fireAt The time at which the timer should expire.
     * @returns A TimerTask that completes when the durable timer expires.
     */
    createTimer: (fireAt: Date) => TimerTask;

    /**
     * Gets the input of the current orchestrator function as a deserialized
     * value.
     */
    getInput: () => unknown;

    /**
     * Sets the JSON-serializable status of the current orchestrator function.
     *
     * The `customStatusObject` value is serialized to JSON and will be made
     * available to the orchestration status query APIs. The serialized JSON
     * value must not exceed 16 KB of UTF-16 encoded text.
     *
     * The serialized `customStatusObject` value will be made available to the
     * aforementioned APIs after the next `yield` or `return` statement.
     *
     * @param customStatusObject The JSON-serializable value to use as the
     * orchestrator function's custom status.
     */
    setCustomStatus: (customStatusObject: unknown) => void;

    /**
     * Waits asynchronously for an event to be raised with the name `name` and
     * returns the event data.
     *
     * External clients can raise events to a waiting orchestration instance
     * using [[raiseEvent]].
     */
    waitForExternalEvent: (name: string) => Task;

    /**
     * 
     */
    Task: ITaskMethods;
}
