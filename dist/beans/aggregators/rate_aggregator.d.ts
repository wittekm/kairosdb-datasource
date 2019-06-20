import { Aggregator } from "./aggregator";
export declare class RateAggregator extends Aggregator {
    static readonly NAME = "rate";
    static fromObject(object: any): RateAggregator;
    constructor();
}
