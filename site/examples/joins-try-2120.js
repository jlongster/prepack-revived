function f(g) {
  try {
    return g();
  } catch (e) {
    return 42;
  }
}
if (global.__optimize) __optimize(f);
