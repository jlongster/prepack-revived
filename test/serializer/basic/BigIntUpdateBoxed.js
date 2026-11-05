(function(){ let a=5n; a++; let b=Object(7n); let c=b; c--; let d=Object(3); d++; global.r=[String(a),String(c),typeof c,d].join(","); })();
inspect=function(){return global.r;};
