function weight(v) {
  var w = 0;
  switch (v) {
    case 1:
      w += 1;
    case 2:
      w += 10;
      break;
    case 3:
      return "three";
    case 4:
    case 5:
      w += 100;
    default:
      w += 1000;
  }
  return w;
}
if (global.__optimize) __optimize(weight);
