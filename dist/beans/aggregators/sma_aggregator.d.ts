import { Aggregator } from "./aggregator";
export declare class SmaAggregator extends Aggregator {
    static readonly NAME = "sma";
    static fromObject(object: any): SmaAggregator;
    constructor();
}
