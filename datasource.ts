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

let self;

    /** @ngInject */
export function KairosDBDatasource(instanceSettings, $q, backendSrv, templateSrv) {
        this.type = instanceSettings.type;
        this.url = instanceSettings.url.replace(/\/+$/, "");
        this.name = instanceSettings.name;
        this.withCredentials = instanceSettings.withCredentials;
        this.supportMetrics = true;
        this.q = $q;
        this.backendSrv = backendSrv;
        this.templateSrv = templateSrv;
        console.log("pow");
        self = this;
    }

    // Function to check Datasource health
    KairosDBDatasource.prototype.testDatasource = function () {
        return self.backendSrv.datasourceRequest({
            url: self.url + '/api/v1/health/check',
            method: 'GET'
        }).then(function (response) {
            if (response.status === 204) {
                return {status: "success", message: "Data source is working", title: "Success"};
            }
        });
    };

    // Called once per panel (graph)
    KairosDBDatasource.prototype.query = function (options: Options) {
        self.panelId = options.panelId;
        let start = options.rangeRaw.from;
        let end = options.rangeRaw.to;

        let targets = expandTargets(options);
        let queries = _.compact(_.map(targets, _.partial(convertTargetToQuery, options)));
        let plotParams = _.compact(_.map(targets, function (target: Target) {
            if (!target.hide) {
                return {alias: target.alias, exouter: target.exOuter};
            }
            else {
                return null;
            }
        }));

        let handleKairosDBQueryResponseAlias = _.partial(handleKairosDBQueryResponse, plotParams, self.templateSrv);

        // No valid targets, return the empty result to save a round trip.
        if (_.isEmpty(queries)) {
            let d = self.q.defer();
            d.resolve({data: []});
            return d.promise;
        }

        return self.performTimeSeriesQuery(queries, start, end)
            .then(handleKairosDBQueryResponseAlias, handleQueryError);
    };

    KairosDBDatasource.prototype.performTimeSeriesQuery = function (queries, start, end) {
        let reqBody = {
            metrics: queries,
            cache_time: 0
        };

        convertToKairosTime(start, reqBody, 'start');
        convertToKairosTime(end, reqBody, 'end');

        let options = {
            method: 'POST',
            withCredentials: self.withCredentials,
            url: self.url + '/api/v1/datapoints/query',
            data: reqBody
        };

        return self.backendSrv.datasourceRequest(options);
    };

    /**
     * Gets the list of metrics
     * @returns {*|Promise}
     */
    KairosDBDatasource.prototype._performMetricSuggestQuery = function (metric: string) {
        //Requires a KairosDB version supporting server-side metric names filtering
        let options = {
            url: self.url + '/api/v1/metricnames?containing=' + metric,
            withCredentials: self.withCredentials,
            method: 'GET',
            requestId: self.panelId + ".metricnames"
        };

        return self.backendSrv.datasourceRequest(options).then(function (response) {
            if (!response.data) {
                return self.q.when([]);
            }
            let metrics = [];
            _.each(response.data.results, function (r) {
                if (r.indexOf(metric) >= 0) {
                    metrics.push(r);
                }
            });
            return metrics;
        });
    };

    KairosDBDatasource.prototype._performMetricKeyLookup = function (metric: string) {
        if (!metric) {
            return self.q.when([]);
        }

        //TODO: get scoped vars here
        let metricNames = getAppliedTemplatedValuesList(metric, self.templateSrv, {});

        let options = {
            method: 'POST',
            url: self.url + '/api/v1/datapoints/query/tags',
            withCredentials: self.withCredentials,
            requestId: "metricKeyLookup",
            data: {
                metrics: _.map(metricNames, n => { return { name: n } } ),
                cache_time: 0,
                start_absolute: 0
            }
        };

        return self.backendSrv.datasourceRequest(options).then(function (result) {
            if (!result.data) {
                return self.q.when([]);
            }
            let tagks = [];
            _.each(result.data.queries[0].results[0].tags, function (tagv, tagk) {
                if (tagks.indexOf(tagk) === -1) {
                    tagks.push(tagk);
                }
            });
            return tagks;
        });
    };

    KairosDBDatasource.prototype._performMetricKeyValueLookup = function (metric, key, otherTags) {
        metric = metric.trim();
        //TODO: get scoped vars here
        let metricNames = getAppliedTemplatedValuesList(metric, self.templateSrv, {});
        key = key.trim();
        if (!metric || !key) {
            return self.q.when([]);
        }

        let metricsOptions = {name: metric};
        if (otherTags) {
            let tags = {};
            let kvps = otherTags.match(/\w+\s*=\s*(?:[^,{}]+|\{[^,{}]+(?:,\s*[^,{}]+)*\})/g);
            kvps.forEach(function (pair) {
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
            withCredentials: self.withCredentials,
            url: self.url + '/api/v1/datapoints/query/tags',
            requestId: self.panelId + "." + metric + "." + key + "." + "metricKeyValueLookup",
            data: {
                metrics: allOptions,
                cache_time: 0,
                start_absolute: 0
            }
        };

        return self.backendSrv.datasourceRequest(options).then(function (result) {
            if (!result.data) {
                return self.q.when([]);
            }
            return result.data.queries[0].results[0].tags[key];
        });
    };

    KairosDBDatasource.prototype.performTagSuggestQuery = function (metric) {
        let options = {
            url: self.url + '/api/v1/datapoints/query/tags',
            method: 'POST',
            withCredentials: self.withCredentials,
            requestId: "tagSuggestQuery",
            data: {
                metrics: [
                    {name: metric}
                ],
                cache_time: 0,
                start_absolute: 0
            }
        };

        return self.backendSrv.datasourceRequest(options).then(function (response) {
            if (!response.data) {
                return [];
            }
            else {
                return response.data.queries[0].results[0];
            }
        });
    };

    KairosDBDatasource.prototype.metricFindQuery = function (query) {
        if (!query) {
            return self.q.when([]);
        }

        let interpolated;
        try {
            interpolated = self.templateSrv.replace(query);
        }
        catch (err) {
            return self.q.reject(err);
        }

        let responseTransform = function (result) {
            return _.map(result, function (value) {
                return {text: value};
            });
        };

        let metrics_regex = /metrics\((.*)\)/;
        let tag_names_regex = /tag_names\((.*)\)/;
        let tag_values_regex = /tag_values\(([^,]*),\s*([^,]*)(?:,\s*)?(\w+\s*=.*)?\)/;

        let metrics_query = interpolated.match(metrics_regex);
        if (metrics_query) {
            return self._performMetricSuggestQuery(metrics_query[1]).then(responseTransform);
        }

        let tag_names_query = query.match(tag_names_regex);
        if (tag_names_query) {
            return self._performMetricKeyLookup(tag_names_query[1]).then(responseTransform);
        }

        let tag_values_query = query.match(tag_values_regex);
        if (tag_values_query) {
            return self._performMetricKeyValueLookup(tag_values_query[1], tag_values_query[2], tag_values_query[3]).then(responseTransform);
        }

        return self.q.when([]);
    };

    /////////////////////////////////////////////////////////////////////////
    /// Formatting methods
    ////////////////////////////////////////////////////////////////////////

    /**
     * Requires a verion of KairosDB with every CORS defects fixed
     * @param results
     * @returns {*}
     */
    function handleQueryError(results) {
        if (results.data.errors && !_.isEmpty(results.data.errors)) {
            let errors = {
                message: results.data.errors[0]
            };
            return self.q.reject(errors);
        }
        else {
            return self.q.reject(results);
        }
    }

    function handleKairosDBQueryResponse(plotParams, templateSrv, results) {
        let output = [];
        let index = 0;
        _.each(results.data.queries, function (series: any) {
            _.each(series.results, function (result: any) {
                let details = "";
                let target = plotParams[index].alias;
                let groupAliases = {};
                let valueGroup = 1;
                let timeGroup = 1;
                let histogram = false;
                let preBucket = false;
                let histoSeries = {};

                // collect values for group aliases, then use them as scopedVars for templating
                _.each(result.group_by, function (element: any) {
                    if (element.name === "tag") {
                        _.each(element.group, function (value, key) {
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
                        datapoints = PeakFilter(datapoints, 10);
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

    function getAppliedTemplatedValuesList(value: string, templateSrv: TemplateServ, scopedVars: ScopedVars): string[] {
        let replacedValue = _.map(_.flatten([value]), function (value) {
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
                        let variable = _.find(templateSrv.variables, function (v) {
                            return v.name === variableName;
                        });
                        if (variable === undefined) {
                            //Looks like a variable, but it's not bound
                            return match[0];
                        }
                        if (templateSrv.isAllValue(variable.current.value)) {
                            let filteredOptions = _.filter(variable.options, function (v) {
                                return v.value !== "$__all";
                            });
                            return _.map(filteredOptions, function (opt) {
                                return match[1] + opt.value + match[5];
                            });
                        } else {
                            return _.map(variable.current.value, function (val) {
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

    function convertTargetToQuery(options, target: Target) {
        if (!target.metric || target.hide) {
            return null;
        }

        let metricName = target.metric;
        let query: Query = new Query();
        query.name = metricName;

        if (target.horizontalAggregators) {
            _.each(target.horizontalAggregators, function (chosenAggregator) {
                let returnedAggregator: any = {
                    name: chosenAggregator.name
                };

                if (chosenAggregator.sampling_rate) {
                    returnedAggregator.sampling = self.convertToKairosInterval(
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
            _.forOwn(query.tags, function (value: string, key: string) {
                query.tags[key] = getAppliedTemplatedValuesList(value, self.templateSrv, options.scopedVars);
            });
        }

        if (target.groupByTags || target.nonTagGroupBys) {
            query.group_by = [];
            if (target.groupByTags) {
                query.group_by.push({
                    name: "tag",
                    tags: _.map(angular.copy(target.groupByTags), function (tag) {
                        return self.templateSrv.replace(tag);
                    })
                });
            }

            if (target.nonTagGroupBys) {
                _.each(target.nonTagGroupBys, function (rawGroupBy) {
                    let formattedGroupBy = angular.copy(rawGroupBy);
                    if (formattedGroupBy.name === 'time') {
                        formattedGroupBy.range_size = self.convertToKairosInterval(formattedGroupBy.range_size);
                    }
                    query.group_by.push(formattedGroupBy);
                });
            }
        }
        return query;
    }

    KairosDBDatasource.prototype.getDefaultAlias = function (target: Target) {
        if (!target.metric) {
            return "";
        }

        let groupAlias = " ( ";
        let valueGroup = 1;
        let timeGroup = 1;

        _.forEach(target.groupByTags, function (tag) {
            groupAlias += tag + "=$_tag_group_" + tag + ", ";
        });
        _.forEach(target.nonTagGroupBys, function (group) {
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

    KairosDBDatasource.prototype.convertToKairosInterval = function (intervalString) {
        intervalString = self.templateSrv.replace(intervalString);

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
            unit: convertToKairosDBTimeUnit(unit)
        };
    };

    function convertToKairosTime(date: string, response_obj: any, start_stop_name: string) {
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
                        unit: convertToKairosDBTimeUnit(unit)
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

    function convertToKairosDBTimeUnit(unit: string) {
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

    function PeakFilter(dataIn, limit) {
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

    function expandTargets(options: Options) {
        return _.flatten(_.map(
            options.targets,
            function (target) {
                let metrics = getAppliedTemplatedValuesList(target.metric, self.templateSrv, options.scopedVars);
                return _.map(metrics,
                    function (metric) {
                        let copy = angular.copy(target);
                        copy.metric = metric;
                        copy.alias = copy.aliasMode === "default" ? self.getDefaultAlias(copy, options) : target.alias;
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

