// A switch on an abstract value with many cases, fall through and conditional returns (#1378).
function f(v, a) {
  var r = 0;
  switch (v) {
    case 0:
      r += 0;
      break;
    case 1:
      r += 1;
      if (a) return r;
    case 2:
      r += 2;
    case 3:
      r += 3;
      break;
    case 4:
      r += 4;
    case 5:
      r += 5;
    case 6:
      r += 6;
      break;
      if (a) return r;
    case 7:
      r += 7;
    case 8:
      r += 8;
    case 9:
      r += 9;
      break;
    case 10:
      r += 10;
    case 11:
      r += 11;
      if (a) return r;
    case 12:
      r += 12;
      break;
    case 13:
      r += 13;
    case 14:
      r += 14;
    case 15:
      r += 15;
      break;
    case 16:
      r += 16;
      if (a) return r;
    case 17:
      r += 17;
    case 18:
      r += 18;
      break;
    case 19:
      r += 19;
    case 20:
      r += 20;
    case 21:
      r += 21;
      break;
      if (a) return r;
    case 22:
      r += 22;
    case 23:
      r += 23;
    case 24:
      r += 24;
      break;
    case 25:
      r += 25;
    case 26:
      r += 26;
      if (a) return r;
    case 27:
      r += 27;
      break;
    case 28:
      r += 28;
    case 29:
      r += 29;
    default:
      r = -1;
  }
  return r;
}
if (global.__optimize) __optimize(f);
inspect = function() {
  var o = [];
  for (var i = -1; i < 32; i++) {
    o.push(f(i, true), f(i, false));
  }
  return o.join();
};
