"use strict";

/* global _, console, queue, d3, dv */

var datafile = "data/movies.json",data, table;

var concat = function(a,b){return a.concat(b);};
var getRColNames = function(formulae){
  var keys = _(formulae).map(function(f){
    var split = f.split("~");
    var all = split[1].split("+");
    all.push(split[0]);
    return all;
  }).reduce(concat).map(function(a){return a.trim();});
  return _.uniq(keys);
};

/**
 * Convert column names into R format's column names.
 * @param  {String} column name
 * @return {String} formatted name
 */
var convertName = function(c){
  return c.name.replace(/\ /g,".").replace(/\(/g,".").replace(/\)/g,".");
};

var getValue = function(summary, prop, extra_prop){
  var out = summary;
  for(var i=0; i<prop.length ; ++i) out= out[prop[i]];
  if(extra_prop) out = out[extra_prop];
  return out;
};
/**
 * [getValueTable description]
 * @param  {String(Json)} json
 * @param  {dv.table()} table
 * @param  {String} prop properties name e.g. ['coefs','Estimate'], ['df.df']
 * @param  {enum} type SIMPLE/ALL
 * @return Table Values
 */
var getValueTable = function(summariesMap, table, prop, type){
  var type = type || "SIMPLE"; //assign default values

  var formulae = _.keys(json);
  var formulaeByDepVar = _.groupBy(formulae, function(f){ return f.split("~")[0].trim();});

  //kanitw: This part can be improve in terms of performance.
  if(type=="SIMPLE"){
    // for simple output table
    formulaeByDepVar.each(function(formulae,ind_var, map){
      var obj = {};
      _.each(formulae, function(f){ obj[f.split("~")[1].trim()] = f;});
      map[ind_var] = obj;
    });
  }
  var i, j, N=table.cols(), valueTable = [];

  for(i=0; i<N ; ++i){
    for(j=0; j<N; ++j){
      var formula = formulaeByDepVar[table[i].rName][table[j].rName];
      var extra_prop  = (prop[0] === "coefs" && type=="ALL") ? table[j].rName : null;
      var value = getValue(summariesMap[formula],prop, extra_prop);

      valueTable.push(_.merge({
        idx1: i,
        idx2: j,
        name1: table[i].name,
        name2: table[j].name,
        value: value
      }));
    }
  }


};

queue()
  .defer(d3.json, datafile)
  .defer(d3.json, "movies-out/simple_linear.json")
  .defer(d3.json, "movies-out/simple_linear_all.json")
  .defer(d3.json, "movies-out/long_linear.json")
  .defer(d3.json, "movies-out/long_linear_all.json")
  .await(function(err, data, sl, sla, ll,lla) {
    if (err) {
      console.log(err);
      alert(err);
      return;
    }
    // var rColNames = getRColNames(Object.keys(sla));

    //create data table
    table = dv.table();
    var idx = 0;
    data.forEach(function(c, i) {
      c.rName = convertName(c.name); // Add R format column name
      makeColumns(c).forEach(function(c) {
        console.log((idx++) + ": " + c.name + " | " + c.vals.lut.length);
        table.addColumn(c.name, c.vals, null, true);
      });
    });

    console.log("TABLE", table.rows());

    var i, j, N = table.cols(), dist = [];
    for (i=0; i<N; ++i) {
      for (j=i+1; j<N; ++j) {
        dist.push({
          idx1:  i,
          idx2:  j,
          name1: table[i].name,
          name2: table[j].name,
          dist:  distance(table, i, j)
        });
      }
    }

    var matrix = dist.reduce(function(a, d) {
      // make symmetric
      a.push(d);
      a.push({idx1:d.idx2, idx2:d.idx1, name1:d.name2, name2:d.name1, dist:d.dist});
      return a;
    }, []);
    self.matrix = matrix;
    show(matrix);
  });

function makeColumns(col) {
  var name = col.name,
      type = col.type || dv.type.unknown,
      data = col.values;

  var cols;
  if (type === "numeric") {
    cols = [
      {
        name: name+":bin20",
        vals: bin(data, 20)
      }
    ];
  } else if (type === "date") {
    var dates = data.map(function(v) { return new Date(v); });
    cols = [
      {
        name: name+":year", // year
        vals: dates.map(function(d) { return d.getFullYear(); })
      },
      {
        name: name+":month", // months
        vals: dates.map(function(d) { return d.getMonth(); })
      },
      {
        name: name+":day", // day of week
        vals: dates.map(function(d) { return d.getDay(); })
      }
    ];
  } else {
    cols = [
      {
        name: name,
        vals: data
      }
    ];
  }

  cols.forEach(function(c) { c.vals = column(c.vals); });
  return cols;
}

// -- MAP VALUES TO INTEGER CODES
// Datavore can do this for us, but we take care of it manually here

function column(values) {
  var vals = [];
  vals.lut = code(values);
  for (var i=0, map=dict(vals.lut); i < values.length; ++i) {
    vals.push(map[values[i]]);
  }
  vals.get = function(idx) { return this.lut[this[idx]]; }
  return vals;
}

/** @private */
function code(a) {
  var c = [], d = {}, v;
  for (var i=0, len=a.length; i<len; ++i) {
    if (d[v=a[i]] === undefined) {
      d[v] = 1;
      c.push(v);
    }
  }
  return typeof(c[0]) !== "number"
    ? c.sort()
    : c.sort(function(a,b) { return a - b; });
};

/** @private */
function dict(lut) {
  return lut.reduce(function(a,b,i) { a[b] = i; return a; }, {});
};

// -- BINNING
// Given a numeric variable, discretize it into bins

function bin(values, bins, min, max, step) {
  var bmin = min !== undefined,
      bmax = max !== undefined;
  min = bmin ? min : minval(values);
  max = bmax ? max : maxval(values);
  var span = max - min, s, def;

  /* Special case: empty, invalid or infinite span. */
  if (!span || !isFinite(span)) {
    def = [min, min, 1];
  } else {
    s = Math.pow(10, Math.round(Math.log(span) / Math.log(10)) - 1),
    def = [Math.floor(min/s) * s, Math.ceil(max/s) * s];
    if (bmin) def[0] = min;
    if (bmax) def[1] = max;
    span = def[1] - def[0];

    if (step === undefined) {
      step = logFloor(span / bins, 10);
      var err = bins / (span / step);
      if (err <= .15) step *= 10;
      else if (err <= .35) step *= 5;
      else if (err <= .75) step *= 2;
    }
    def.push(step);
  }

  var range = def[1] - def[0],
      step  = def[2],
      uniq  = Math.ceil(range / step),
      i, v, a = [], N = values.length;
  for (i=0; i<N; ++i) {
    v = values[i];
    if (v == null) {
      idx = unique;
    } else if (v < def[0] || v > def[1])
      idx = -1;
    else if (v == def[1]) {
      idx = uniq - 1;
    } else {
      idx = ~~((v-def[0]) / step);
    }
    a.push(idx);
  }

  return a;
}

function minval(x) {
  var m = Infinity, i=0, l=x.length;
  for (; i<l; ++i){
    v = x[i];
    if (v < m) m = v;
  }
  return m;
}

function maxval(x) {
  var m = -Infinity, i=0, l=x.length;
  for (; i<l; ++i){
    v = x[i];
    if (v > m) m = v;
  }
  return m;
}

function logFloor(x, b) {
  return (x > 0)
    ? Math.pow(b, Math.floor(Math.log(x) / Math.log(b)))
    : -Math.pow(b, -Math.floor(-Math.log(-x) / Math.log(b)));
}

// -- MUTUAL INFORMATION
// Given two discrete distributions, compare them

function distance(t, i, j) {
  var data = t.query({
    dims: [i, j],
    vals: [dv.count("*")],
    code: true
  });
  return mi_dist(data);
}

function mi_dist(data) {
  var x = data[0],
      y = data[1],
      z = data[2],
      px = dv.array(x.unique),
      py = dv.array(y.unique),
      i, s = 0, t, N = z.length, p, I = 0;

  for (i=0; i<N; ++i) {
    px[x[i]] += z[i];
    py[y[i]] += z[i];
    s += z[i];
  }
  t = 1 / (s * Math.LN2);
  for (i = 0; i < N; ++i) {
    if (z[i] === 0) continue;
    p = (s * z[i]) / (px[x[i]] * py[y[i]]);
    I += z[i] * t * Math.log(p);
  }
  px = entropy(px);
  py = entropy(py);
  return 1.0 - I / (px > py ? px : py);
}

function entropy(x) {
  var i, p, s = 0, H = 0, N = x.length;
  for (i=0; i<N; ++i) {
    s += x[i];
  }
  if (s === 0) return 0;
  for (i=0; i<N; ++i) {
    p = x[i] / s;
    if (p > 0) H += p * Math.log(p) / Math.LN2;
  }
  return -H;
}

// -- VISUALIZE
// Show a distance matrix

function show(mat) {
  var N = d3.max(mat, function(d) { return d.idx1; }) + 1,
      s = 10,
      w = N*s,
      h = N*s,
      m = 160;

  var c = d3.scale.pow()
    .exponent(6)
    .domain([
      d3.min(mat, function(d) { return d.dist; }),
      d3.max(mat, function(d) { return d.dist; }),
    ])
    .range(["steelblue", "#efefef"]);

  var svg = d3.select("#left").append("svg")
    .attr("width", w+m)
    .attr("height", h+m);

  var g = svg.append("g")
    .attr("transform", "translate("+(m-1)+","+(m-1)+")");

  g.selectAll("rect")
    .data(mat)
   .enter().append("rect")
    .attr("x", function(d) { return d.idx1 * s; })
    .attr("y", function(d) { return d.idx2 * s; })
    .attr("width", s)
    .attr("height", s)
    .style("fill", function(d) { return c(d.dist); })
   .append("title")
    .text(function(d) { return d.dist.toFixed(4) + " " + d.name1 + " x " + d.name2; })
    .on("click", function(x){

    }); 

  g.selectAll("text.left")
    .data(mat.filter(function(d) { return d.idx1 == 0 || d.idx1 == 1 && d.idx2 == 0; }))
   .enter().append("text")
    .attr("x", 0)
    .attr("y", function(d) { return d.idx2 * s; })
    .attr("dx", -2)
    .attr("dy", "0.78em")
    .attr("text-anchor", "end")
    .text(function(d) { return d.name2; })
    .style("font", "9px Helvetica Neue");

  g.selectAll("text.top")
    .data(mat.filter(function(d) { return d.idx1 == 0 || d.idx1 == 1 && d.idx2 == 0; }))
   .enter().append("g")
    .attr("transform", function(d) { return "translate("+(d.idx2*s)+",0)"; })
   .append("text")
    .attr("dx", 2)
    .attr("dy", "0.78em")
    .attr("text-anchor", "start")
    .attr("transform", "rotate(-90)")
    .text(function(d) { return d.name2; })
    .style("font", "9px Helvetica Neue");
}