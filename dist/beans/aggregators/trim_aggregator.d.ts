import { Aggregator } from "./aggregator";
export declare class TrimAggregator extends Aggregator {
    static readonly NAME = "trim";
    static fromObject(object: any): TrimAggregator;
    constructor();
}
