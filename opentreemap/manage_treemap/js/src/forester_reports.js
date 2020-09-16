"use strict";

var $ = require('jquery'),
    _ = require('lodash'),
    Bacon = require('baconjs'),
    toastr = require('toastr'),
    BU = require('treemap/lib/baconUtils.js'),
    U = require('treemap/lib/utility.js'),
    buttonEnabler = require('treemap/lib/buttonEnabler.js'),
    errors = require('manage_treemap/lib/errors.js'),
    simpleEditForm = require('treemap/lib/simpleEditForm.js'),
    adminPage = require('manage_treemap/lib/adminPage.js'),
    config = require('treemap/lib/config.js'),
    Chart = require('Chart'),
    reverse = require('reverse');

// https://datatables.net/forums/discussion/43042/uncaught-typeerror-cannot-set-property-of-undefined
require('imports?define=>false!datatables.net')(window, $);


var dom = {
    spinner: '.spinner',
    newFieldsAlert: '#new-fields-alert',
    newFieldsDismiss: '#new-fields-dismiss',

    chart: '#group-chart canvas',
    treeCountsChart: '#tree-counts-chart canvas',
    speciesChart: '#species-chart canvas',
    treeConditionsChart: '#tree-conditions-chart canvas',
    treeConditionsBySpeciesChart: '#tree-conditions-by-species-chart canvas',

    treesTable: '#trees-table',
    treesTableHeader: '#trees-table thead',
    treesTableBody: '#trees-table tbody',
};

var charts = {
    treeCountsChart: null,
    speciesChart: null,
    treeConditionsChart: null,
    treeConditionsBySpeciesChart: null,

    treesTableHeader: null,
    treesTableBody: null,
};

// a cache to hold our data
var dataCache = {
    treeCountsChart: null,
    treeConditionsChart: null,
    treeConditionsBySpeciesChart: null,
    trees: null,
};

var onValueFunctions = {
    treeCountsChart: null,
    treeConditionsChart: null,
    treeConditionsBySpeciesChart: null,
    trees: null,
}

var url = reverse.roles_endpoint(config.instance.url_name);

function loadData() {

    var aggregationLevel = $(dom.aggregationLevelDropdown).val();
    var aggregationLevel = 'ward'
    var treeCountStream = BU.jsonRequest(
        'GET',
        reverse.get_reports_data(config.instance.url_name, 'count', aggregationLevel)
    )();
    treeCountStream.onError(showError);
    treeCountStream.onValue(onValueFunctions.treeCountsChart);

    var treeConditionsStream = BU.jsonRequest(
        'GET',
        reverse.get_reports_data(config.instance.url_name, 'condition', aggregationLevel)
    )();
    treeConditionsStream.onError(showError);
    treeConditionsStream.onValue(onValueFunctions.treeConditionsChart);

    var treeConditionsBySpeciesStream = BU.jsonRequest(
        'GET',
        reverse.get_reports_data(config.instance.url_name, 'condition_by_species', aggregationLevel)
    )();
    treeConditionsBySpeciesStream.onError(showError);
    treeConditionsBySpeciesStream.onValue(onValueFunctions.treeConditionsBySpeciesChart);

    //$(dom.ecobenefitsByWardTotal).html('');
    $(dom.spinner).show();
    var treesStream = BU.jsonRequest(
        'GET',
        reverse.get_reports_data(config.instance.url_name, 'forester_trees', aggregationLevel)
    )();
    treesStream.onError(showError);
    treesStream.onValue(onValueFunctions.trees);
}


function showError(resp) {
    enableSave();
    toastr.error(resp.responseText);
}

var chartColors = {
	orange: 'rgb(255, 159, 64)',
	yellow: 'rgb(255, 205, 86)',
	green: 'rgb(75, 192, 192)',
	blue: 'rgb(54, 162, 235)',
	purple: 'rgb(153, 102, 255)',
	grey: 'rgb(201, 203, 207)',

    // a less saturated red
    red: '#8b1002',

    // a softer black
    black: '#303031'
};

// theme from https://learnui.design/tools/data-color-picker.html
// starting with #8baa3d, which is the otm-green color in
// _base.scss
var otmGreen = '#8baa3d';
var otmLimeGreen = '#add142';
var chartColorTheme = [
    '#003f5c',
    '#00506b',
    '#006274',
    '#007374',
    '#00836c',
    '#1c935f',
    '#59a04e',
    '#8baa3d'
];


onValueFunctions.treeCountsChart = function (results) {
    var data = results['data']
    dataCache.treeCountsChart = data;

    if (charts.treeCountsChart == null) {
        var chart = new Chart($(dom.treeCountsChart), {
            type: 'bar',
            data: {
                labels: [],
                datasets: []
            }
        });

        charts.treeCountsChart = chart;
    }

    updateTreeCountsData(data);
};

function updateTreeCountsData(data) {
    var chart = charts.treeCountsChart;
    if (chart == null) {
        return;
    }

    chart.data.labels = data.map(x => x['name']);
    chart.data.datasets = [{
        label: 'Trees',
        borderColor: otmLimeGreen,
        backgroundColor: otmGreen,
        data: data.map(x => x['count'])
    }];
    chart.update();
}

onValueFunctions.speciesChart = function (results) {
    var data = results['data'];
    dataCache.speciesChart = data;

    updateSpeciesData(data);
}

function updateSpeciesData(data) {
    var chart = charts.speciesChart;
    if (chart != null) {
        chart.destroy();
    }

    // reduce the species and counts, as there are multiple given the aggregation
    var reduceFunc = function(acc, value) {
        acc[value['species_name']] = acc[value['species_name']] + value['count']
            || value['count'];
        return acc;
    }
    var dataObj = data.reduce(reduceFunc, {});
    // make into a list of items and sort descending
    data = Object.keys(dataObj).map(k => {return {name: k, count: dataObj[k]}})
        .sort((first, second) => second['count'] - first['count']);

    // take the first N and aggregate the rest
    var finalData = data.slice(0, 5);
    var otherSum = data.slice(5).reduce((acc, val) => acc + val['count'], 0);
    finalData.push({name: 'Other', count: otherSum})

    var chart = new Chart($(dom.speciesChart), {
        type: 'pie',
        data: {
            labels: finalData.map(x => x['name']),
            datasets: [{
                data: finalData.map(x => x['count']),
                backgroundColor: finalData.map((x, i) => chartColorTheme[i]),
                borderColor: 'rgba(200, 200, 200, 0.75)',
                hoverBorderColor: 'rgba(200, 200, 200, 1)',
            }]
        }
    });
    charts.speciesChart = chart;
    chart.update();
}

onValueFunctions.treeConditionsChart = function (results) {
    var data = results['data'];
    dataCache.treeConditionsChart = data;

    if (charts.treeConditionsChart == null) {
        var chart = new Chart($(dom.treeConditionsChart), {
            type: 'bar',
            options: {
                scales: {
                    xAxes: [{
                        stacked: true,
                    }],
                    yAxes: [{
                        stacked: true
                    }]
                }
            },
            data: {
                labels: [],
                datasets: []
            }
        });
        charts.treeConditionsChart = chart;
    }

    updateTreeConditionsChart(data);
}

function updateTreeConditionsChart(data) {
    var chart = charts.treeConditionsChart;
    if (chart == null) {
        return;
    }

    chart.data.labels = data.map(x => x['name']);
    chart.data.datasets = [
        {
            label: 'Healthy',
            data: data.map(x => x['healthy']),
            backgroundColor: otmGreen
        },
        {
            label: 'Unhealthy',
            data: data.map(x => x['unhealthy']),
            backgroundColor: chartColors.red
        },
        {
            label: 'Dead',
            data: data.map(x => x['dead']),
            backgroundColor: chartColors.black
        },
        {
            label: 'Sidewalk Issue',
            data: data.map(x => x['sidewalk_issue']),
            backgroundColor: chartColorTheme[3]
        },
        {
            label: 'Power Lines Issue',
            data: data.map(x => x['power_lines_issue']),
            backgroundColor: chartColorTheme[5]
        }
    ];
    chart.update();
}

onValueFunctions.treeConditionsBySpeciesChart = function (results) {
    var data = results['data'];
    dataCache.treeConditionsBySpeciesChart = data;

    if (charts.treeConditionsBySpeciesChart == null) {
        var chart = new Chart($(dom.treeConditionsBySpeciesChart), {
            type: 'bar',
            options: {
                scales: {
                    xAxes: [{
                        stacked: true,
                    }],
                    yAxes: [{
                        stacked: true
                    }]
                }
            },
            data: {
                labels: [],
                datasets: []
            }
        });
        charts.treeConditionsBySpeciesChart = chart;
    }

    updateTreeConditionsBySpeciesChart(data);
}

function updateTreeConditionsBySpeciesChart(data) {
    var chart = charts.treeConditionsBySpeciesChart;
    if (chart == null) {
        return;
    }

    chart.data.labels = data.map(x => x['name']);
    chart.data.datasets = [
        {
            label: 'Healthy',
            data: data.map(x => x['healthy']),
            backgroundColor: otmGreen
        },
        {
            label: 'Unhealthy',
            data: data.map(x => x['unhealthy']),
            backgroundColor: chartColors.red
        },
        {
            label: 'Dead',
            data: data.map(x => x['dead']),
            backgroundColor: chartColors.black
        },
        {
            label: 'Sidewalk Issue',
            data: data.map(x => x['sidewalk_issue']),
            backgroundColor: chartColorTheme[3]
        },
        {
            label: 'Power Lines Issue',
            data: data.map(x => x['power_lines_issue']),
            backgroundColor: chartColorTheme[5]
        }
    ];
    chart.update();
}

onValueFunctions.trees = function (results) {
    var data = results['data'];
    dataCache.trees = data;
    $(dom.spinner).hide();
    updateTrees(data);
}

function updateTrees(data) {
    var columns = data['columns'];
    var columnHtml = '<tr>' + columns.map(x => '<th>' + x + '</th>').join('') + '</tr>';
    var dataHtml = data['data'].map(row => '<tr>' + row.map((x, i) => {
        if (row[0] == 'Total') {
            return '<td><b>' + formatColumn(x, columns[i]) + '</b></td>';
        }
        return '<td>' + formatColumn(x, columns[i]) + '</td>';
    }).join('') + '</tr>').join('');

    $(dom.treesTableHeader).html(columnHtml);
    $(dom.treesTableBody).html(dataHtml);
    $(dom.treesTable).DataTable();
}

function formatColumn(column, columnName) {
    if (column == null)
        return '';
    if (columnName == 'plot_id') {
        var url = reverse.map_feature_detail(config.instance.url_name, column);
        return '<a href="' + url  + '">Link</a>';
    }
    if (typeof column == 'number' && columnName.indexOf('$') != -1)
        return '$' + column.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    if (typeof column == 'number' && column < 0.00001)
        return '';
    if (typeof column == 'number')
        return column.toLocaleString(undefined, {
            maximumFractionDigits: 4
        });
    return column;
}


buttonEnabler.run();
U.modalsFocusOnFirstInputWhenShown();

var alertDismissStream = $(dom.newFieldsDismiss).asEventStream('click')
    .doAction('.preventDefault')
    .map(undefined)
    .flatMap(BU.jsonRequest('POST', $(dom.newFieldsDismiss).attr('href')));

alertDismissStream.onValue(function() {
    $(dom.newFieldsAlert).hide();
});

adminPage.init(Bacon.mergeAll(alertDismissStream));

loadData();
