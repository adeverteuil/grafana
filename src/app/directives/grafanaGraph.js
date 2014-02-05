define([
  'angular',
  'jquery',
  'kbn',
  'moment',
  'underscore'
],
function (angular, $, kbn, moment, _) {
  'use strict';

  var module = angular.module('kibana.directives');

  module.directive('grafanaGraph', function(filterSrv, $rootScope, dashboard) {
    return {
      restrict: 'A',
      template: '<div> </div>',
      link: function(scope, elem) {
        var data, plot;
        var hiddenData = {};

        scope.$on('refresh',function() {
          if (scope.otherPanelInFullscreenMode()) { return; }

          scope.get_data();
        });

        scope.$on('toggleLegend', function(e, alias) {
          if (hiddenData[alias]) {
            data.push(hiddenData[alias]);
            delete hiddenData[alias];
          }

          render_panel();
        });

        // Receive render events
        scope.$on('render',function(event, d) {
          data = d || data;
          render_panel();
        });

        // Re-render if the window is resized
        angular.element(window).bind('resize', function() {
          render_panel();
        });

        function setElementHeight() {
          try {
            elem.css({ height: scope.height || scope.panel.height || scope.row.height });
            return true;
          } catch(e) { // IE throws errors sometimes
            return false;
          }
        }

        // Function for rendering panel
        function render_panel() {
          if (!data) { return; }
          if (scope.otherPanelInFullscreenMode()) { return; }
          if (!setElementHeight()) { return; }

          if (_.isString(data)) {
            render_panel_as_graphite_png(data);
            return;
          }

          _.each(data, function(series) {
            series.label = series.info.alias;
            series.color = series.info.color;
          });

          _.each(_.keys(scope.hiddenSeries), function(seriesAlias) {
            var dataSeries = _.find(data, function(series) {
              return series.info.alias === seriesAlias;
            });
            if (dataSeries) {
              hiddenData[dataSeries.info.alias] = dataSeries;
              data = _.without(data, dataSeries);
            }
          });

          // Set barwidth based on specified interval
          var barwidth = kbn.interval_to_ms(scope.interval);

          var stack = scope.panel.stack ? true : null;

          // Populate element
          var options = {
            legend: { show: false },
            series: {
              stackpercent: scope.panel.stack ? scope.panel.percentage : false,
              stack: scope.panel.percentage ? null : stack,
              lines:  {
                show: scope.panel.lines,
                // Silly, but fixes bug in stacked percentages
                fill: scope.panel.fill === 0 ? 0.001 : scope.panel.fill/10,
                lineWidth: scope.panel.linewidth,
                steps: scope.panel.steppedLine
              },
              bars:   {
                show: scope.panel.bars,
                fill: 1,
                barWidth: barwidth/1.5,
                zero: false,
                lineWidth: 0
              },
              points: {
                show: scope.panel.points,
                fill: 1,
                fillColor: false,
                radius: scope.panel.pointradius
              },
              shadowSize: 1
            },
            yaxes: [],
            xaxis: {
              timezone: dashboard.current.timezone,
              show: scope.panel['x-axis'],
              mode: "time",
              min: _.isUndefined(scope.range.from) ? null : scope.range.from.getTime(),
              max: _.isUndefined(scope.range.to) ? null : scope.range.to.getTime(),
              timeformat: time_format(scope.interval),
              label: "Datetime",
              ticks: elem.width()/100
            },
            grid: {
              backgroundColor: null,
              borderWidth: 0,
              hoverable: true,
              color: '#c8c8c8'
            },
            selection: {
              mode: "x",
              color: '#666'
            }
          };

          addAnnotations(options);

          for (var i = 0; i < data.length; i++) {
            var _d = data[i].time_series.getFlotPairs(scope.panel.nullPointMode);
            data[i].yaxis = data[i].info.yaxis;
            data[i].data = _d;
            data[i].info.y_format = data[i].yaxis === 1 ? scope.panel.y_format : scope.panel.y2_format;
          }

          configureAxisOptions(data, options);

          plot = $.plot(elem, data, options);

          addAxisLabels();
        }

        function render_panel_as_graphite_png(url) {
          url += '&width=' + elem.width();
          url += '&height=' + elem.css('height').replace('px', '');
          url += '&bgcolor=1f1f1f'; // @grayDarker & @kibanaPanelBackground
          url += '&fgcolor=BBBFC2'; // @textColor & @grayLighter
          url += scope.panel.stack ? '&areaMode=stacked' : '';
          url += scope.panel.fill !== 0 ? ('&areaAlpha=' + (scope.panel.fill/10).toFixed(1)) : '';
          url += scope.panel.linewidth !== 0 ? '&lineWidth=' + scope.panel.linewidth : '';
          url += scope.panel.legend ? '' : '&hideLegend=true';
          url += scope.panel.grid.min ? '&yMin=' + scope.panel.grid.min : '';
          url += scope.panel.grid.max ? '&yMax=' + scope.panel.grid.max : '';
          url += scope.panel['x-axis'] ? '' : '&hideAxes=true';
          url += scope.panel['y-axis'] ? '' : '&hideYAxis=true';

          switch(scope.panel.y_format) {
          case 'bytes':
            url += '&yUnitSystem=binary';
            break;
          case 'short':
            url += '&yUnitSystem=si';
            break;
          case 'none':
            url += '&yUnitSystem=none';
            break;
          }

          switch(scope.panel.nullPointMode) {
          case 'connected':
            url += '&lineMode=connected';
            break;
          case 'null':
            break; // graphite default lineMode
          case 'null as zero':
            url += "&drawNullAsZero=true";
            break;
          }

          url += scope.panel.steppedLine ? '&lineMode=staircase' : '';

          elem.html('<img src="' + url + '"></img>');
        }


        function addAnnotations(options) {
          if(scope.panel.annotate.enable) {
            options.events = {
              levels: 1,
              data: scope.annotations,
              types: {
                'annotation': {
                  level: 1,
                  icon: {
                    icon: "icon-tag icon-flip-vertical",
                    size: 20,
                    color: "#222",
                    outline: "#bbb"
                  }
                }
              }
            };
          }
        }

        function addAxisLabels() {
          if (scope.panel.leftYAxisLabel) {
            elem.css('margin-left', '10px');
            var yaxisLabel = $("<div class='axisLabel yaxisLabel'></div>")
              .text(scope.panel.leftYAxisLabel)
              .appendTo(elem);

            yaxisLabel.css("margin-top", yaxisLabel.width() / 2 - 20);
          } else if (elem.css('margin-left')) {
            elem.css('margin-left', '');
          }
        }

        function configureAxisOptions(data, options) {
          var defaults = {
            position: 'left',
            show: scope.panel['y-axis'],
            min: scope.panel.grid.min,
            max: scope.panel.percentage && scope.panel.stack ? 100 : scope.panel.grid.max,
          };

          options.yaxes.push(defaults);

          if (_.findWhere(data, {yaxis: 2})) {
            var secondY = _.clone(defaults);
            secondY.position = 'right';
            options.yaxes.push(secondY);
            configureAxisMode(options.yaxes[1], scope.panel.y2_format);
          }

          configureAxisMode(options.yaxes[0], scope.panel.y_format);
        }

        function configureAxisMode(axis, format) {
          if (format === 'bytes') {
            axis.mode = "byte";
          }
          if (format === 'short') {
            axis.tickFormatter = function(val) {
              return kbn.shortFormat(val,0);
            };
          }
          if (format === 'ms') {
            axis.tickFormatter = kbn.msFormat;
          }
        }

        function time_format(interval) {
          var _int = kbn.interval_to_seconds(interval);
          if(_int >= 2628000) {
            return "%Y-%m";
          }
          if(_int >= 10000) {
            return "%Y-%m-%d";
          }
          if(_int >= 60) {
            return "%H:%M<br>%m-%d";
          }

          return "%H:%M:%S";
        }

        var $tooltip = $('<div>');

        elem.bind("plothover", function (event, pos, item) {
          var group, value, timestamp;
          if (item) {
            if (item.series.info.alias || scope.panel.tooltip.query_as_alias) {
              group = '<small style="font-size:0.9em;">' +
                '<i class="icon-circle" style="color:'+item.series.color+';"></i>' + ' ' +
                (item.series.info.alias || item.series.info.query)+
              '</small><br>';
            } else {
              group = kbn.query_color_dot(item.series.color, 15) + ' ';
            }
            value = (scope.panel.stack && scope.panel.tooltip.value_type === 'individual') ?
              item.datapoint[1] - item.datapoint[2] :
              item.datapoint[1];
            if(item.series.info.y_format === 'bytes') {
              value = kbn.byteFormat(value,2);
            }
            if(item.series.info.y_format === 'short') {
              value = kbn.shortFormat(value,2);
            }
            if(item.series.info.y_format === 'ms') {
              value = kbn.msFormat(value);
            }
            timestamp = dashboard.current.timezone === 'browser' ?
              moment(item.datapoint[0]).format('YYYY-MM-DD HH:mm:ss') :
              moment.utc(item.datapoint[0]).format('YYYY-MM-DD HH:mm:ss');
            $tooltip
              .html(
                group + value + " @ " + timestamp
              )
              .place_tt(pos.pageX, pos.pageY);
          } else {
            $tooltip.detach();
          }
        });

        elem.bind("plotselected", function (event, ranges) {
          filterSrv.setTime({
            from  : moment.utc(ranges.xaxis.from).toDate(),
            to    : moment.utc(ranges.xaxis.to).toDate(),
          });
        });
      }
    };
  });

});