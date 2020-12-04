const LogPlease = require("logplease");

export enum LogNameSpaces {
    Parser = "parser"
}

class LoggerManager {
    private levels = ["DEBUG", "INFO", "WARN", "ERROR", "NONE"];
    private defaultName = "global";

    private instances: { [name: string]: any } = {};
    private allowed?: string[];

    constructor(level: string, allowed?: string[]) {
        if (this.levels.includes(level)) {
            LogPlease.setLogLevel(level);
        } else {
            throw new Error(`Invalid log level ${level}. Valid levels: ${this.levels.join(", ")}`);
        }

        this.allowed = allowed;
    }

    isAllowed(name: string): boolean {
        return this.allowed === undefined || this.allowed.includes(name);
    }

    debug(message: string, name?: string) {
        name = name || this.defaultName;

        if (this.isAllowed(name)) {
            this.getInstance(name).debug(message);
        }
    }

    log(message: string, name?: string) {
        name = name || this.defaultName;

        if (this.isAllowed(name)) {
            this.getInstance(name).log(message);
        }
    }

    info(message: string, name?: string) {
        name = name || this.defaultName;

        if (this.isAllowed(name)) {
            this.getInstance(name).info(message);
        }
    }

    warn(message: string, name?: string) {
        name = name || this.defaultName;

        if (this.isAllowed(name)) {
            this.getInstance(name).warn(message);
        }
    }

    error(message: string, name?: string) {
        name = name || this.defaultName;

        if (this.isAllowed(name)) {
            this.getInstance(name).error(message);
        }
    }

    private getInstance(name: string): any {
        if (!(name in this.instances)) {
            this.instances[name] = LogPlease.create(name);
        }

        return this.instances[name];
    }
}

const envLevel = process.env.DEBUG_LEVEL ? process.env.DEBUG_LEVEL.toUpperCase() : "NONE";
const envAllowed = process.env.DEBUG_FILTER ? process.env.DEBUG_FILTER.split(",") : undefined;

export const Logger = new LoggerManager(envLevel, envAllowed);
