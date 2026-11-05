// Every quote on the page, copied verbatim from the linked comment, issue, gist or source line
// (fetched from the GitHub API / HN API on 2026-11-05). Typos are the authors'.
"use strict";

const ISSUE = n => `https://github.com/facebookarchive/prepack/issues/${n}`;
const C = (n, id) => `${ISSUE(n)}#issuecomment-${id}`;
const SRC = (file, line) =>
  `https://github.com/facebookarchive/prepack/blob/5beedbe85bd5b9d2de1264abafbb3b76f8584297/${file}#L${line}`;

module.exports = {
  ISSUE,
  SRC,
  quotes: {
    "venter-712-explode": {
      text:
        "Among the many concerns I have is how we are to save the global state when we suspend execution because of a Yield and how we are to restore it when resuming the generator. Throw in speculative evaluation (the kind we get when abstractly interpreting an if statement with an unknown condition) and my head start to explode.",
      who: "Herman Venter",
      role: "Prepack lead",
      where: "#712, June 9, 2017",
      url: C(712, 307511442),
    },
    "venter-712-iterate": {
      text: "More importantly, how do you iterate an if statement where the condition is abstract?",
      who: "Herman Venter",
      role: "Prepack lead",
      where: "#712, June 10, 2017",
      url: C(712, 307529395),
    },
    "venter-1750": {
      text:
        "This is indeed kind of like a loop. In the static analysis world, this is know as computing the outer fixed point. Doing it properly is a bridge too far for us right now, so some hackery will be require in the meanwhile.",
      who: "Herman Venter",
      role: "Prepack lead",
      where: "#1750, April 17, 2018",
      url: C(1750, 382195818),
    },
    "venter-1722": {
      text:
        "Yes, with loops you have to widen and once you widen, precision is lost. Range domains let you regain some of this precision. If you range over an unbounded collection of strings and use them as property names, it's pretty much game over.",
      who: "Herman Venter",
      role: "Prepack lead",
      where: "#1722, April 9, 2018",
      url: C(1722, 379851076),
    },
    "tillmann-2055": {
      text: "Prepack gives up when hitting the loop with the abstract condition. This is a hard problem.",
      who: "Nikolai Tillmann",
      role: "Prepack engineer",
      where: "#2055, June 1, 2018",
      url: C(2055, 394020729),
    },
    "tillmann-520": {
      text:
        "Prepack cannot just skip a loop (or recursive call), as Prepack then wouldn't know what all possible side effects on the heap would, and what values the code could return or exceptions it could throw. That's a hard problem, and it's on our longer term roadmap.",
      who: "Nikolai Tillmann",
      role: "Prepack engineer",
      where: "#520, May 8, 2017",
      url: C(520, 299891608),
    },
    "tillmann-1586": {
      text:
        "In general, the question whether a function call is going to result in unbounded recursion is undecidable. The check we have currently is known to be conceptually too conservative --- it just looks whether a recursive call is guarded by <em>any</em> abstract condition.",
      who: "Nikolai Tillmann",
      role: "Prepack engineer",
      where: "#1586, March 14, 2018",
      url: C(1586, 373015391),
    },
    "venter-1378": {
      text:
        "Remember to update the path conditions and bear in mind that fall throughs complicate this.",
      who: "Herman Venter",
      role: "Prepack lead",
      where: "#1378, January 30, 2018 (labeled “level 4 (hard)”)",
      url: ISSUE(1378),
    },
    "calebmer-2354": {
      text: "Prepack outputs invalid code without a diagnostic.",
      who: "Caleb Meredith",
      role: "author of Prepack’s fuzzer",
      where: "#2354, August 1, 2018",
      url: ISSUE(2354),
    },
    "venter-580": {
      text: "I'm not sure we are ready to head down this slippery slope of reasoning over abstract arithmetic.",
      who: "Herman Venter",
      role: "Prepack lead",
      where: "#580, May 5, 2017",
      url: C(580, 299596321),
    },
    "venter-1891": {
      text:
        "If we havoced everything that is read by an optimized function, we'll probably find it impossible to do any optimizations at all.",
      who: "Herman Venter",
      role: "Prepack lead",
      where: "#1891, May 8, 2018",
      url: C(1891, 387488819),
    },
    "venter-24": {
      text:
        "Getting to the point where it can usefully run on real browser based applications is going to take a lot of very hard work and a long time.",
      who: "Herman Venter",
      role: "Prepack lead",
      where: "#24 “Add DOM shims”, July 29, 2018",
      url: C(24, 408696869),
    },
    "venter-24-nothing": {
      text:
        "Some previous work on analyzing JavaScript has already highlighted just how difficult things become once you try to support all of JavaScript and you have to deal with untyped call backs. The conclusion reached in those efforts was that, in the end, the analyzer knows nothing much.",
      who: "Herman Venter",
      role: "Prepack lead",
      where: "#24, July 29, 2018",
      url: C(24, 408696869),
    },
    "abramov-2140": {
      text:
        "This is the “best” kind of bloat in the sense that it's caused by Prepack working as intended, and actually running the component code.",
      who: "Dan Abramov",
      role: "React team",
      where: "#2140 “React code bloat: Inlining Explosion”, June 20, 2018",
      url: ISSUE(2140),
    },
    "abramov-hn": {
      text: "One compiler bailout, and the difference in the bundle is huge.",
      who: "Dan Abramov",
      role: "React team",
      where: "Hacker News, December 21, 2020",
      url: "https://news.ycombinator.com/item?id=25499545",
    },
    "markbage-gist": {
      text:
        "We hit a similar trajectory with the work we did on Prepack. That also had other problems but this is ultimately the reason we abandoned that particular approach.",
      who: "Sebastian Markbåge",
      role: "React team",
      where: "gist on compiled output size",
      url: "https://gist.github.com/sebmarkbage/a5ef436427437a98408672108df01919",
    },
    "venter-2639-scenario": {
      text:
        "The short story is that no one currently at Facebook seems to have a scenario in mind where they believe that Prepack can be of use.",
      who: "Herman Venter",
      role: "Prepack lead",
      where: "#2639 “Is prepack dead?”, February 13, 2020",
      url: C(2639, 585997029),
    },
    "venter-2639-whole": {
      text:
        "The biggest challenge with Prepack is that you need the whole program along with an accurate model of the environment it will run in. Even then, you can only really run it on global code (or code that is known to  only depend on state that is set up by the global code and never modified later).",
      who: "Herman Venter",
      role: "Prepack lead",
      where: "#2639, February 13, 2020",
      url: C(2639, 585997029),
    },
    "venter-2639-babel": {
      text:
        "Another big challenge is that Prepack is built on top of Babel and requires source code to be lowered by Babel into EcmaScript 5. […] Updating Prepack to the latest JavaScript edition will be a lot of work.",
      who: "Herman Venter",
      role: "Prepack lead",
      where: "#2639, February 13, 2020",
      url: C(2639, 585997029),
    },
    "venter-2639-flow": {
      text: "If I had to do it all over, I would stick to my original plan and use Flow as the basis for Prepack.",
      who: "Herman Venter",
      role: "Prepack lead",
      where: "#2639, February 13, 2020",
      url: C(2639, 585997029),
    },
    "venter-1174": {
      text:
        "If the behavior of a loop can be nicely summarized as a set of unknown properties on known objects, the the effects of the loop on the heap is known and it will be safe to emit a residual loop into the code at the point of time associated with the loop.",
      who: "Herman Venter",
      role: "Prepack lead",
      where: "#1174 “Compute fixed points for loops”, November 18, 2017 (still open)",
      url: ISSUE(1174),
    },
    "src-generatortree": {
      text: "TODO: There's something else going on that is not yet understood.",
      who: "Prepack source",
      role: "",
      where: "src/serializer/GeneratorTree.js, line 61",
      url: SRC("src/serializer/GeneratorTree.js", 61),
    },
    "src-call-1586": {
      text:
        "TODO #1586: abstractRecursionSummarization is disabled for now, as it is likely too limiting (as observed in large internal tests).",
      who: "Prepack source",
      role: "",
      where: "src/methods/call.js, line 400",
      url: SRC("src/methods/call.js", 400),
    },
    "src-for-6": {
      text: "If we have no increment and we've hit 6 iterations of trying to evaluate this loop body, then see if we have a break, return or throw completion in a guarded condition and fail if it does.",
      who: "Prepack source",
      role: "",
      where: "src/evaluators/ForStatement.js, line 172",
      url: SRC("src/evaluators/ForStatement.js", 172),
    },
    "src-realm-712": {
      text: "suspend(): void { // TODO #712: suspend }",
      who: "Prepack source",
      role: "",
      where: "src/realm.js, line 230",
      url: SRC("src/realm.js", 230),
    },
  },
};
