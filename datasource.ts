///<reference path="./common.d.ts" />
///<amd-dependency path="./query_ctrl" />
import angular = require('angular');
import _ = require('lodash');


import dateMath from 'app/core/utils/datemath';
import kbn from 'app/core/utils/kbn';

class Query {
    name: string;
    aggregators: QueryAggregator[] = [];
    tags: { [id: string]: string[] } = {};
    group_by: QueryGroupBy[] = [];
}

class QueryAggregator {

}


class QueryGroupBy {

}

type ScopedVars = { [id: string]: ScopedVariable };

type TemplateServ = {
    variableExists(varName: string): boolean;
    isAllValue(value: string): boolean;
    replace(value: string): string;
    replace(value: string, scopedVars: ScopedVars): string;
    replace(value: string, scopedVars: ScopedVars, format: string): string;
    variables: QueryVariable[];
}

type QueryVariable = {
    name: string;
    options: TemplateVariableOption[];
    current: TemplateVariableOption;
}

type Options = {
    panelId: any;
    rangeRaw: RangeRaw;
    targets: Target[];
    scopedVars: ScopedVars;
    interval: string;
}

type RangeRaw = {
    from: string;
    to: string;
}

type Target = {
    metric: string;
    alias: string;
    exOuter: any;
    hide: boolean;
    aliasMode: AliasMode;
    horizontalAggregators: HorizontalAggregator[];
    groupByTags: string[];
    tags: { [id: string]: string[] };
    nonTagGroupBys: any[];
}

type HorizontalAggregator = {
    name: string;
    sampling_rate: string;
    factor: number;
    unit: string;
    percentile: number;
    target: number;
    trim: TrimMode;
}

type TemplateVariableOption = {
    text: string;
    value: any;
    selected: boolean;
}

type ScopedVariable = {
    text: string;
    value: any;
}

type AliasMode = "custom" | "default";
type TrimMode = "both" | "first" | "last";

class KairosdDBDatasource {
    private url: string;
    private type: string;
    private name: string;
    private withCredentials: any;
    private supportMetrics: boolean;
    private q: any;
    private backendSrv: any;
    private templateSrv: TemplateServ;
    private panelId: string;


    /** @ngInject */
    constructor(instanceSettings, $q, backendSrv, templateSrv) {
        this.type = instanceSettings.type;
        this.url = instanceSettings.url.replace(/\/+$/, "");
        this.name = instanceSettings.name;
        this.withCredentials = instanceSettings.withCredentials;
        this.supportMetrics = true;
        this.q = $q;
        this.backendSrv = backendSrv;
        this.templateSrv = templateSrv;
        console.log("pow");
    }

    // Function to check Datasource health
    testDatasource() {
        return this.backendSrv.datasourceRequest({
            url: this.url + '/api/v1/health/check',
            method: 'GET'
        }).then((response) => {
            if (response.status === 204) {
                return {status: "success", message: "Data source is working", title: "Success"};
            }
        });
    };

    // Called once per panel (graph)
    query(options: Options) {
        this.panelId = options.panelId;
        let start = options.rangeRaw.from;
        let end = options.rangeRaw.to;

        let targets = this.expandTargets(options);
        let queries = _.compact(_.map(targets, _.bind(this.convertTargetToQuery, this, options)));
        let plotParams = _.compact(_.map(targets, (target: Target) => {
            if (!target.hide) {
                return {alias: target.alias, exouter: target.exOuter};
            }
            else {
                return null;
            }
        }));

        let handleKairosDBQueryResponseAlias = _.bind(this.handleKairosDBQueryResponse, this, plotParams, this.templateSrv);


        // No valid targets, return the empty result to save a round trip.
        if (_.isEmpty(queries)) {
            let d = this.q.defer();
            d.resolve({data: []});
            return d.promise;
        }

        return this.performTimeSeriesQuery(queries, start, end)
            .then(handleKairosDBQueryResponseAlias, this.handleQueryError);
    };

    performTimeSeriesQuery(queries, start, end) {
        let reqBody = {
            metrics: queries,
            cache_time: 0
        };

        this.convertToKairosTime(start, reqBody, 'start');
        this.convertToKairosTime(end, reqBody, 'end');

        let options = {
            method: 'POST',
            withCredentials: this.withCredentials,
            url: this.url + '/api/v1/datapoints/query',
            data: reqBody
        };

        return this.backendSrv.datasourceRequest(options);
    };

    /**
     * Gets the list of metrics
     * @returns {*|Promise}
     */
    _performMetricSuggestQuery(metric: string) {
        //Requires a KairosDB version supporting server-side metric names filtering
        let options = {
            url: this.url + '/api/v1/metricnames?containing=' + metric,
            withCredentials: this.withCredentials,
            method: 'GET',
            requestId: this.panelId + ".metricnames"
        };

        return this.backendSrv.datasourceRequest(options).then((response) => {
            if (!response.data) {
                return this.q.when([]);
            }
            let metrics = [];
            _.each(response.data.results, (r) => {
                if (r.indexOf(metric) >= 0) {
                    metrics.push(r);
                }
            });
            return metrics;
        });
    };

    _performMetricKeyLookup(metric: string) {
        if (!metric) {
            return this.q.when([]);
        }

        //TODO: get scoped vars here
        let metricNames = this.getAppliedTemplatedValuesList(metric, this.templateSrv, {});

        let options = {
            method: 'POST',
            url: this.url + '/api/v1/datapoints/query/tags',
            withCredentials: this.withCredentials,
            requestId: "metricKeyLookup",
            data: {
                metrics: _.map(metricNames, n => { return { name: n } } ),
                cache_time: 0,
                start_absolute: 0
            }
        };

        return this.backendSrv.datasourceRequest(options).then((result) => {
            if (!result.data) {
                return this.q.when([]);
            }
            let tagks = [];
            _.each(result.data.queries[0].results[0].tags, (tagv, tagk) => {
                if (tagks.indexOf(tagk) === -1) {
                    tagks.push(tagk);
                }
            });
            return tagks;
        });
    };

    _performMetricKeyValueLookup(metric, key, otherTags) {
        metric = metric.trim();
        //TODO: get scoped vars here
        let metricNames = this.getAppliedTemplatedValuesList(metric, this.templateSrv, {});
        key = key.trim();
        if (!metric || !key) {
            return this.q.when([]);
        }

        let metricsOptions = {name: metric};
        if (otherTags) {
            let tags = {};
            let kvps = otherTags.match(/\w+\s*=\s*(?:[^,{}]+|\{[^,{}]+(?:,\s*[^,{}]+)*\})/g);
            kvps.forEach((pair) => {
                let kv = pair.split("=");
                let k = kv[0] ? kv[0].trim() : "";
                let value = kv[1] ? kv[1].trim() : "";
                if (value.search(/^\{.*\}$/) !== -1) // multi-value, probably from a template var. e.g., "{dog,cat,bird}"
                {
                    value = value.slice(1, -1).split(/\s*,\s*/);
                }
                if (k && value) {
                    tags[k] = value;
                }
            });
            metricsOptions["tags"] = tags;
        }

        let allOptions = _.map(metricNames, n => { let mo = angular.copy(metricsOptions); mo.name = n; return mo; });
        let options = {
            method: 'POST',
            withCredentials: this.withCredentials,
            url: this.url + '/api/v1/datapoints/query/tags',
            requestId: this.panelId + "." + metric + "." + key + "." + "metricKeyValueLookup",
            data: {
                metrics: allOptions,
                cache_time: 0,
                start_absolute: 0
            }
        };

        return this.backendSrv.datasourceRequest(options).then((result) => {
            if (!result.data) {
                return this.q.when([]);
            }
            return result.data.queries[0].results[0].tags[key];
        });
    };

    performTagSuggestQuery(metric) {
        let options = {
            url: this.url + '/api/v1/datapoints/query/tags',
            method: 'POST',
            withCredentials: this.withCredentials,
            requestId: "tagSuggestQuery",
            data: {
                metrics: [
                    {name: metric}
                ],
                cache_time: 0,
                start_absolute: 0
            }
        };

        return this.backendSrv.datasourceRequest(options).then((response) => {
            if (!response.data) {
                return [];
            }
            else {
                return response.data.queries[0].results[0];
            }
        });
    };

    metricFindQuery(query) {
        if (!query) {
            return this.q.when([]);
        }

        let interpolated;
        try {
            interpolated = this.templateSrv.replace(query);
        }
        catch (err) {
            return this.q.reject(err);
        }

        let responseTransform = (result) => {
            return _.map(result, (value) => {
                return {text: value};
            });
        };

        let metrics_regex = /metrics\((.*)\)/;
        let tag_names_regex = /tag_names\((.*)\)/;
        let tag_values_regex = /tag_values\(([^,]*),\s*([^,]*)(?:,\s*)?(\w+\s*=.*)?\)/;

        let metrics_query = interpolated.match(metrics_regex);
        if (metrics_query) {
            return this._performMetricSuggestQuery(metrics_query[1]).then(responseTransform);
        }

        let tag_names_query = query.match(tag_names_regex);
        if (tag_names_query) {
            return this._performMetricKeyLookup(tag_names_query[1]).then(responseTransform);
        }

        let tag_values_query = query.match(tag_values_regex);
        if (tag_values_query) {
            return this._performMetricKeyValueLookup(tag_values_query[1], tag_values_query[2], tag_values_query[3]).then(responseTransform);
        }

        return this.q.when([]);
    };

    /////////////////////////////////////////////////////////////////////////
    /// Formatting methods
    ////////////////////////////////////////////////////////////////////////

    /**
     * Requires a verion of KairosDB with every CORS defects fixed
     * @param results
     * @returns {*}
     */
    handleQueryError(results) {
        if (results.data.errors && !_.isEmpty(results.data.errors)) {
            let errors = {
                message: results.data.errors[0]
            };
            return this.q.reject(errors);
        }
        else {
            return this.q.reject(results);
        }
    }

    handleKairosDBQueryResponse(plotParams, templateSrv, results) {
        let output = [];
        let index = 0;
        _.each(results.data.queries, (series: any) => {
            _.each(series.results, (result: any) => {
                let details = "";
                let target = plotParams[index].alias;
                let groupAliases = {};
                let valueGroup = 1;
                let timeGroup = 1;
                let histogram = false;
                let preBucket = false;
                let histoSeries = {};

                // collect values for group aliases, then use them as scopedVars for templating
                _.each(result.group_by, (element: any) => {
                    if (element.name === "tag") {
                        _.each(element.group, (value, key) => {
                            groupAliases["_tag_group_" + key] = {value: value};

                            // If the Alias name starts with $group_by, then use that
                            // as the label
                            if (target.startsWith('$group_by(')) {
                                let aliasname = target.split('$group_by(')[1].slice(0, -1);
                                if (aliasname === key) {
                                    target = value;
                                }
                            }
                            else {
                                details += key + "=" + value + " ";
                            }
                        });
                    }
                    else if (element.name === "value") {
                        groupAliases["_value_group_" + valueGroup] = {value: element.group.group_number.toString()};
                        valueGroup++;
                    }
                    else if (element.name === "time") {
                        groupAliases["_time_group_" + timeGroup] = {value: element.group.group_number.toString()};
                        timeGroup++;
                    }
                });

                target = templateSrv.replace(target, groupAliases);

                let datapoints = [];

                for (let i = 0; i < result.values.length; i++) {
                    let t = Math.floor(result.values[i][0]);
                    let v = result.values[i][1];
                    if (typeof v === 'object') {
                        if (v.bins) {
                            let obj = v.bins;
                            for (let key in obj) {
                                if (obj.hasOwnProperty(key)) {
                                    if (preBucket) {
                                        target = key;
                                        datapoints = histoSeries[key] || [];
                                        datapoints.push([obj[key], t]);
                                        histoSeries[key] = datapoints;
                                        histogram = true;
                                    } else {
                                        datapoints.push([parseFloat(key), t, obj[key]]);
                                    }
                                }
                            }
                        }
                    } else {
                        datapoints[i] = [v, t];
                    }
                }

                if (!histogram && !preBucket) {
                    if (plotParams[index].exouter) {
                        datapoints = this.peakFilter(datapoints, 10);
                    }
                    output.push({target: target, datapoints: datapoints});
                } else {
                    for (let alias in histoSeries) {
                        if (histoSeries.hasOwnProperty(alias)) {
                            output.push({target: alias, datapoints: histoSeries[alias]});
                        }
                    }
                }
            });

            index++;
        });

        return {data: _.flatten(output)};
    }

    getAppliedTemplatedValuesList(value: string, templateSrv: TemplateServ, scopedVars: ScopedVars): string[] {
        let replacedValue = _.map(_.flatten([value]), (value) => {
            // Make sure there is a variable in the value
            if (templateSrv.variableExists(value)) {
                // Check to see if the value is just a single variable
                let fullVariableRegex = /(.*?)(\$(\w+)|\[\[\s*(\w+)\s*\]\])(.*)/g;
                let match = fullVariableRegex.exec(value);
                if (match) {
                    let variableName = match[3] || match[4];
                    if (scopedVars && scopedVars[variableName]) {
                        return match[1] + scopedVars[variableName].value + match[5];
                    } else {
                        let variable = _.find(templateSrv.variables, (v) => {
                            return v.name === variableName;
                        });
                        if (variable === undefined) {
                            //Looks like a variable, but it's not bound
                            return match[0];
                        }
                        if (templateSrv.isAllValue(variable.current.value)) {
                            let filteredOptions = _.filter(variable.options, (v) => {
                                return v.value !== "$__all";
                            });
                            return _.map(filteredOptions, (opt) => {
                                return match[1] + opt.value + match[5];
                            });
                        } else {
                            return _.map(variable.current.value, (val) => {
                                return match[1] + val + match[5];
                            });
                        }
                    }
                } else {
                    // Supposedly it has a value, but we don't know how to match it.
                    console.warn("unknown how to match variable");
                    return templateSrv.replace(value, scopedVars);
                }
            } else {
                // The value does not have a variable
                return value;
            }
        });
        return _.flatten(replacedValue);
    }

    convertTargetToQuery(options: Options, target: Target) {
        if (!target.metric || target.hide) {
            return null;
        }

        let metricName = target.metric;
        let query: Query = new Query();
        query.name = metricName;

        if (target.horizontalAggregators) {
            _.each(target.horizontalAggregators, (chosenAggregator: HorizontalAggregator):void => {
                let returnedAggregator: any = {
                    name: chosenAggregator.name
                };

                if (chosenAggregator.sampling_rate) {
                    returnedAggregator.sampling = this.convertToKairosInterval(
                        chosenAggregator.sampling_rate === "auto" ? options.interval : chosenAggregator.sampling_rate);
                    returnedAggregator.align_sampling = true;
                    //returnedAggregator.align_start_time = true;
                }

                if (chosenAggregator.unit) {
                    returnedAggregator.unit = chosenAggregator.unit + 's';
                }

                if (chosenAggregator.factor && chosenAggregator.name === 'div') {
                    returnedAggregator.divisor = chosenAggregator.factor;
                }
                else if (chosenAggregator.factor && chosenAggregator.name === 'scale') {
                    returnedAggregator.factor = chosenAggregator.factor;
                }

                if (chosenAggregator.percentile) {
                    returnedAggregator.percentile = chosenAggregator.percentile;
                }

                if (chosenAggregator.target) {
                    returnedAggregator.target = chosenAggregator.target;
                }

                if (chosenAggregator.trim) {
                    returnedAggregator.trim = chosenAggregator.trim;
                }

                query.aggregators.push(returnedAggregator);
            });
        }

        if (_.isEmpty(query.aggregators)) {
            delete query.aggregators;
        }

        if (target.tags) {
            query.tags = angular.copy(target.tags);
            _.forOwn(query.tags, _.bind((value: string, key: string) => {
                query.tags[key] = this.getAppliedTemplatedValuesList(value, this.templateSrv, options.scopedVars);
            }, this));
        }

        if (target.groupByTags || target.nonTagGroupBys) {
            query.group_by = [];
            if (target.groupByTags) {
                query.group_by.push({
                    name: "tag",
                    tags: _.map(angular.copy(target.groupByTags), (tag) => {
                        return this.templateSrv.replace(tag);
                    })
                });
            }

            if (target.nonTagGroupBys) {
                _.each(target.nonTagGroupBys, (rawGroupBy) => {
                    let formattedGroupBy = angular.copy(rawGroupBy);
                    if (formattedGroupBy.name === 'time') {
                        formattedGroupBy.range_size = this.convertToKairosInterval(formattedGroupBy.range_size);
                    }
                    query.group_by.push(formattedGroupBy);
                });
            }
        }
        return query;
    }

    getDefaultAlias(target: Target) {
        if (!target.metric) {
            return "";
        }

        let groupAlias = " ( ";
        let valueGroup = 1;
        let timeGroup = 1;

        _.forEach(target.groupByTags, (tag) => {
            groupAlias += tag + "=$_tag_group_" + tag + ", ";
        });
        _.forEach(target.nonTagGroupBys, (group) => {
            if (group.name === "value") {
                groupAlias += "value_group_" + valueGroup + "=$_value_group_" + valueGroup.toString() + ", ";
                valueGroup++;
            } else if (group.name === "time") {
                groupAlias += "time_group_" + timeGroup + "=$_time_group_" + timeGroup.toString() + ", ";
                timeGroup++;
            }
        });

        if (groupAlias === " ( ") {
            groupAlias = "";
        } else {
            groupAlias = groupAlias.substring(0, groupAlias.length - 2) + " )";
        }

        return target.metric + groupAlias;
    };

    ///////////////////////////////////////////////////////////////////////
    /// Time conversion functions specifics to KairosDB
    //////////////////////////////////////////////////////////////////////

    convertToKairosInterval(intervalString) {
        intervalString = this.templateSrv.replace(intervalString);

        let interval_regex = /(\d+(?:\.\d+)?)([Mwdhmsy])/;
        let interval_regex_ms = /(\d+(?:\.\d+)?)(ms)/;
        let matches = intervalString.match(interval_regex_ms);
        if (!matches) {
            matches = intervalString.match(interval_regex);
        }
        if (!matches) {
            throw new Error('Invalid interval string, expecting a number followed by one of "y M w d h m s ms"');
        }

        let value = matches[1];
        let unit = matches[2];
        if (value % 1 !== 0) {
            if (unit === 'ms') {
                throw new Error('Invalid interval value, cannot be smaller than the millisecond');
            }
            value = Math.round(kbn.intervals_in_seconds[unit] * value * 1000);
            unit = 'ms';
        }

        return {
            value: value,
            unit: this.convertToKairosDBTimeUnit(unit)
        };
    };

    convertToKairosTime(date: string, response_obj: any, start_stop_name: string) {
        let name;

        if (_.isString(date)) {
            if (date === 'now') {
                return;
            }
            else if (date.indexOf('now-') >= 0 && date.indexOf('/') === -1) {
                date = date.substring(4);
                name = start_stop_name + "_relative";
                let re_date = /(\d+)\s*(\D+)/;
                let result = re_date.exec(date);

                if (result) {
                    let value = result[1];
                    let unit = result[2];

                    response_obj[name] = {
                        value: value,
                        unit: this.convertToKairosDBTimeUnit(unit)
                    };
                    return;
                }
                console.log("Unparseable date", date);
                return;
            }

            date = dateMath.parse(date, start_stop_name === 'end');
        }

        name = start_stop_name + "_absolute";
        response_obj[name] = date.valueOf();
    }

    convertToKairosDBTimeUnit(unit: string) {
        switch (unit) {
            case 'ms':
                return 'milliseconds';
            case 's':
                return 'seconds';
            case 'm':
                return 'minutes';
            case 'h':
                return 'hours';
            case 'd':
                return 'days';
            case 'w':
                return 'weeks';
            case 'M':
                return 'months';
            case 'y':
                return 'years';
            default:
                console.log("Unknown unit ", unit);
                return '';
        }
    }

    peakFilter(dataIn, limit) {
        let datapoints = dataIn;
        let arrLength = datapoints.length;
        if (arrLength <= 3) {
            return datapoints;
        }
        let LastIndx = arrLength - 1;

        // Check first point
        let prvDelta = Math.abs((datapoints[1][0] - datapoints[0][0]) / datapoints[0][0]);
        let nxtDelta = Math.abs((datapoints[1][0] - datapoints[2][0]) / datapoints[2][0]);
        if (prvDelta >= limit && nxtDelta < limit) {
            datapoints[0][0] = datapoints[1][0];
        }

        // Check last point
        prvDelta = Math.abs((datapoints[LastIndx - 1][0] - datapoints[LastIndx - 2][0]) / datapoints[LastIndx - 2][0]);
        nxtDelta = Math.abs((datapoints[LastIndx - 1][0] - datapoints[LastIndx][0]) / datapoints[LastIndx][0]);
        if (prvDelta >= limit && nxtDelta < limit) {
            datapoints[LastIndx][0] = datapoints[LastIndx - 1][0];
        }

        for (let i = 1; i < arrLength - 1; i++) {
            prvDelta = Math.abs((datapoints[i][0] - datapoints[i - 1][0]) / datapoints[i - 1][0]);
            nxtDelta = Math.abs((datapoints[i][0] - datapoints[i + 1][0]) / datapoints[i + 1][0]);
            if (prvDelta >= limit && nxtDelta >= limit) {
                datapoints[i][0] = (datapoints[i - 1][0] + datapoints[i + 1][0]) / 2;
            }
        }

        return datapoints;
    }

    expandTargets(options: Options): Target[] {
        return _.flatten(_.map(
            options.targets,
            (target: Target): Target[] => {
                let metrics = this.getAppliedTemplatedValuesList(target.metric, this.templateSrv, options.scopedVars);
                return _.map(metrics,
                    (metric: string) => {
                        let copy = angular.copy(target);
                        copy.metric = metric;
                        copy.alias = copy.aliasMode === "default" ? this.getDefaultAlias(copy) : target.alias;
                        //TODO: Generate a list of variables used by metric
                        // generate a list of variables used by alias
                        // alias variables should be a subset of metric variables
                        // for each metric, there should be a list of var1->value1, var2->value2 bindings
                        // use those bindings as scopedVars to bind each alias
                        // Note: there needs to be another argument added to the currentTemplateValuething call that return a list [ templateValue -> {variable->binding} ]
                        return copy;
                    }
                );
            }
        ));
    }
}

export function KairosDBDatasource(instanceSettings, $q, backendSrv, templateSrv) {
    return new KairosdDBDatasource(instanceSettings, $q, backendSrv, templateSrv);
}
