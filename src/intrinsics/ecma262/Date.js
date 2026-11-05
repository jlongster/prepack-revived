/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow strict-local */

import type { Realm } from "../../realm.js";
import { AbstractValue, NativeFunctionValue, NumberValue, StringValue, ObjectValue } from "../../values/index.js";
import { Create, To } from "../../singletons.js";
import {
  MakeTime,
  MakeDate,
  MakeDay,
  TimeClip,
  UTC,
  ToDateString,
  thisTimeValue,
  msPerMinute,
} from "../../methods/date.js";
import { FatalError } from "../../errors.js";
import { Placeholders } from "../../utils/PreludeGenerator.js";
import { lookupTimezoneOffsetAssumption } from "../env/assumptions.js";
import invariant from "../../invariant.js";
import seedrandom from "seedrandom";

const buildDateNowSrc = "global.Date.now()";

// ISO 8601 strings that carry an explicit UTC/offset designator (or ES2015+ date-only UTC form).
function hasExplicitTimezoneInDateString(str: string): boolean {
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(str)) return true;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/.test(str)) return true;
  return false;
}

export default function(realm: Realm): NativeFunctionValue {
  let lastNow;
  let offsetGenerator;
  function getCurrentTime(): AbstractValue | NumberValue {
    if (realm.useAbstractInterpretation) {
      return AbstractValue.createTemporalFromTemplate(realm, buildDateNowSrc, NumberValue, [], {
        isPure: true,
        skipInvariant: true,
      });
    } else {
      let newNow = Date.now();
      if (realm.strictlyMonotonicDateNow && lastNow >= newNow) {
        if (!offsetGenerator) offsetGenerator = seedrandom(0);
        // certain behaviors in the test262 test suite can only be (reliably) triggered if Date.now() is strictly monotonically increasing
        // TODO #1004: Set the strictlyMonotonicDateNow option on the realm in the test262 test runner, fix the issues that will come up in the tests, and remove this comment.
        newNow = lastNow + 1 + Math.floor(offsetGenerator() * 500);
      }
      lastNow = newNow;
      return new NumberValue(realm, newNow);
    }
  }

  // ECMA262 20.3.2
  let func = new NativeFunctionValue(realm, "Date", "Date", 7, (context, args, argCount, NewTarget) => {
    if (argCount >= 2) {
      // ECMA262 20.3.2.1
      let [year, month, date, hours, minutes, seconds, ms] = args;

      // 1. Let numberOfArgs be the number of arguments passed to this function call.
      let numberOfArgs = argCount;

      // 2. Assert: numberOfArgs ≥ 2.
      invariant(numberOfArgs >= 2, "expected two or more arguments");

      // 3. If NewTarget is not undefined, then
      if (NewTarget) {
        let maxArgs = Math.min(argCount, 7);
        let rawSlice = args.slice(0, maxArgs);
        if (
          realm.useAbstractInterpretation &&
          !realm.closedWorld &&
          rawSlice.some(a => a instanceof AbstractValue) &&
          rawSlice.every(a => a instanceof NumberValue || (a instanceof AbstractValue && !a.mightNotBeNumber()))
        ) {
          let O = Create.OrdinaryCreateFromConstructor(realm, NewTarget, "DatePrototype", { $DateValue: undefined });
          let params = Placeholders.slice(0, maxArgs).join(", ");
          O.$DateValue = AbstractValue.createTemporalFromTemplate(
            realm,
            `+new global.Date(${params})`,
            NumberValue,
            rawSlice,
            { isPure: true, skipInvariant: true }
          );
          return O;
        }

        // a. Let y be ? ToNumber(year).
        let y = To.ToNumber(realm, year);

        // b. Let m be ? ToNumber(month).
        let m = To.ToNumber(realm, month);

        // c. If date is supplied, let dt be ? ToNumber(date); else let dt be 1.
        let dt = argCount >= 3 ? To.ToNumber(realm, date) : 1;

        // d. If hours is supplied, let h be ? ToNumber(hours); else let h be 0.
        let h = argCount >= 4 ? To.ToNumber(realm, hours) : 0;

        // e. If minutes is supplied, let min be ? ToNumber(minutes); else let min be 0.
        let min = argCount >= 5 ? To.ToNumber(realm, minutes) : 0;

        // f. If seconds is supplied, let s be ? ToNumber(seconds); else let s be 0.
        let s = argCount >= 6 ? To.ToNumber(realm, seconds) : 0;

        // g. If ms is supplied, let milli be ? ToNumber(ms); else let milli be 0.
        let milli = argCount >= 7 ? To.ToNumber(realm, ms) : 0;

        // h. If y is not NaN and 0 ≤ ToInteger(y) ≤ 99, let yr be 1900+ToInteger(y); otherwise, let yr be y.
        let yr;
        if (!isNaN(y) && To.ToInteger(realm, y) >= 0 && To.ToInteger(realm, y) <= 99) {
          yr = 1900 + To.ToInteger(realm, new NumberValue(realm, y));
        } else {
          yr = y;
        }

        // i. Let finalDate be MakeDate(MakeDay(yr, m, dt), MakeTime(h, min, s, milli)).
        let finalDate = MakeDate(realm, MakeDay(realm, yr, m, dt), MakeTime(realm, h, min, s, milli));

        // j. Let O be ? OrdinaryCreateFromConstructor(NewTarget, "%DatePrototype%", « [[DateValue]] »).
        let O = Create.OrdinaryCreateFromConstructor(realm, NewTarget, "DatePrototype", { $DateValue: undefined });

        // k. Set the [[DateValue]] internal slot of O to TimeClip(UTC(finalDate)).
        if (isNaN(finalDate)) {
          O.$DateValue = realm.intrinsics.NaN;
        } else if (!realm.useAbstractInterpretation || realm.closedWorld) {
          O.$DateValue = TimeClip(realm, UTC(realm, finalDate));
        } else {
          let assumedOffset = lookupTimezoneOffsetAssumption(realm, finalDate);
          if (assumedOffset !== undefined) {
            let localTZA = -assumedOffset * msPerMinute;
            O.$DateValue = TimeClip(realm, finalDate - localTZA);
          } else {
            let numericVals = [y, m, dt, h, min, s, milli].slice(0, maxArgs).map(n => new NumberValue(realm, n));
            let params = Placeholders.slice(0, maxArgs).join(", ");
            O.$DateValue = AbstractValue.createTemporalFromTemplate(
              realm,
              `+new global.Date(${params})`,
              NumberValue,
              numericVals,
              { isPure: true, skipInvariant: true }
            );
          }
        }

        // l. Return O.
        return O;
      } else {
        // 4. Else,
        if (realm.useAbstractInterpretation && !realm.closedWorld) {
          return AbstractValue.createTemporalFromTemplate(realm, "global.Date()", StringValue, [], {
            isPure: true,
            skipInvariant: true,
          });
        }
        // a. Let now be the Number that is the time value (UTC) identifying the current time.
        let now = getCurrentTime().throwIfNotConcreteNumber().value;

        // b. Return ToDateString(now).
        return new StringValue(realm, ToDateString(realm, now));
      }
    } else if (argCount === 1) {
      // ECMA262 20.3.2.2
      let [value_] = args;
      if (
        NewTarget &&
        realm.useAbstractInterpretation &&
        value_ instanceof AbstractValue &&
        !value_.mightNotBeNumber()
      ) {
        let O = Create.OrdinaryCreateFromConstructor(realm, NewTarget, "DatePrototype", { $DateValue: undefined });
        if (
          value_.operationDescriptor &&
          value_.operationDescriptor.type === "ABSTRACT_FROM_TEMPLATE" &&
          value_.operationDescriptor.data.templateSource === buildDateNowSrc
        ) {
          O.$DateValue = value_;
        } else {
          let clipped = AbstractValue.createFromTemplate(realm, "+new global.Date(A)", NumberValue, [value_]);
          O.$DateValue = AbstractValue.convertToTemporalIfArgsAreTemporal(realm, clipped, [value_]);
        }
        return O;
      }
      if (!NewTarget && realm.useAbstractInterpretation && !realm.closedWorld) {
        return AbstractValue.createTemporalFromTemplate(realm, "global.Date()", StringValue, [], {
          isPure: true,
          skipInvariant: true,
        });
      }
      let value = value_.throwIfNotConcrete();

      // 1. Let numberOfArgs be the number of arguments passed to this function call.
      let numberOfArgs = argCount;

      // 2. Assert: numberOfArgs = 1.
      invariant(numberOfArgs === 1, "expected number of arguments to equal 1");

      // 3. If NewTarget is not undefined, then
      if (NewTarget) {
        let tv;

        // a. If Type(value) is Object and value has a [[DateValue]] internal slot, then
        if (value instanceof ObjectValue && value.$DateValue !== undefined) {
          // i. Let tv be thisTimeValue(value).
          tv = thisTimeValue(realm, value);
        } else {
          // b. Else,
          // i. Let v be ? ToPrimitive(value)
          let v = To.ToPrimitive(realm, value);

          // ii. If Type(v) is String, then
          if (v instanceof StringValue) {
            if (
              realm.useAbstractInterpretation &&
              !realm.closedWorld &&
              lookupTimezoneOffsetAssumption(realm) === undefined &&
              !hasExplicitTimezoneInDateString(v.value)
            ) {
              let O = Create.OrdinaryCreateFromConstructor(realm, NewTarget, "DatePrototype", {
                $DateValue: undefined,
              });
              O.$DateValue = AbstractValue.createTemporalFromTemplate(realm, "+new global.Date(A)", NumberValue, [v], {
                isPure: true,
                skipInvariant: true,
              });
              return O;
            }
            // 1. Let tv be the result of parsing v as a date, in exactly the same manner as for the parse
            //    method (20.3.3.2). If the parse resulted in an abrupt completion, tv is the Completion Record.
            tv = new NumberValue(realm, new Date(v.value).getTime());

            // 2. ReturnIfAbrupt(tv).
          } else {
            // iii. Else,
            // 1. Let tv be ? ToNumber(v).
            tv = new NumberValue(realm, To.ToNumber(realm, v));
          }
        }

        // c. Let O be ? OrdinaryCreateFromConstructor(NewTarget, "%DatePrototype%", « [[DateValue]] »).
        let O = Create.OrdinaryCreateFromConstructor(realm, NewTarget, "DatePrototype", { $DateValue: undefined });

        // d. Set the [[DateValue]] internal slot of O to TimeClip(tv).
        O.$DateValue = tv instanceof AbstractValue ? tv : TimeClip(realm, tv);

        // e. Return O.
        return O;
      } else {
        // 4. Else,
        // a. Let now be the Number that is the time value (UTC) identifying the current time.
        let now = getCurrentTime().throwIfNotConcreteNumber().value;

        // b. Return ToDateString(now).
        return new StringValue(realm, ToDateString(realm, now));
      }
    } else {
      // ECMA262 20.3.2.3

      // 1. Let numberOfArgs be the number of arguments passed to this function call.
      let numberOfArgs = argCount;

      // 2. Assert: numberOfArgs = 0.
      invariant(numberOfArgs === 0, "expected zero arguments");

      // 3. If NewTarget is not undefined, then
      if (NewTarget) {
        // a. Let O be ? OrdinaryCreateFromConstructor(NewTarget, "%DatePrototype%", « [[DateValue]] »).
        let O = Create.OrdinaryCreateFromConstructor(realm, NewTarget, "DatePrototype", { $DateValue: undefined });

        // b. Set the [[DateValue]] internal slot of O to the time value (UTC) identifying the current time.
        O.$DateValue = getCurrentTime();

        // c. Return O.
        return O;
      } else {
        if (realm.useAbstractInterpretation && !realm.closedWorld) {
          return AbstractValue.createTemporalFromTemplate(realm, "global.Date()", StringValue, [], {
            isPure: true,
            skipInvariant: true,
          });
        }
        // 4. Else,
        // a. Let now be the Number that is the time value (UTC) identifying the current time.
        let now = getCurrentTime().throwIfNotConcreteNumber().value;

        // b. Return ToDateString(now).
        return new StringValue(realm, ToDateString(realm, now));
      }
    }
  });

  // ECMA262 20.3.3.1
  func.defineNativeMethod("now", 0, context => {
    return getCurrentTime();
  });

  // ECMA262 20.3.3.2
  func.defineNativeMethod("parse", 1, (context, [string]) => {
    if (realm.useAbstractInterpretation) {
      if (string instanceof StringValue) {
        if (realm.closedWorld || hasExplicitTimezoneInDateString(string.value)) {
          return new NumberValue(realm, Date.parse(string.value));
        }
        return AbstractValue.createTemporalFromTemplate(realm, "global.Date.parse(A)", NumberValue, [string], {
          isPure: true,
          skipInvariant: true,
        });
      }
      if (string instanceof AbstractValue && string.getType() === StringValue) {
        return AbstractValue.createTemporalFromTemplate(realm, "global.Date.parse(A)", NumberValue, [string], {
          isPure: true,
          skipInvariant: true,
        });
      }
      AbstractValue.reportIntrospectionError(string);
      throw new FatalError();
    } else {
      const s = To.ToStringPartial(realm, string);
      return new NumberValue(realm, Date.parse(s));
    }
  });

  // ECMA262 20.3.3.4
  func.defineNativeMethod("UTC", 7, (context, [year, month, date, hours, minutes, seconds, ms], argCount) => {
    // 1. Let y be ? ToNumber(year).
    let y = To.ToNumber(realm, year);

    // 2. Let m be ? ToNumber(month).
    let m = argCount >= 2 ? To.ToNumber(realm, month) : 0;

    // 3. If date is supplied, let dt be ? ToNumber(date); else let dt be 1.
    let dt = argCount >= 3 ? To.ToNumber(realm, date) : 1;

    // 4. If hours is supplied, let h be ? ToNumber(hours); else let h be 0.
    let h = argCount >= 4 ? To.ToNumber(realm, hours) : 0;

    // 5. If minutes is supplied, let min be ? ToNumber(minutes); else let min be 0.
    let min = argCount >= 5 ? To.ToNumber(realm, minutes) : 0;

    // 6. If seconds is supplied, let s be ? ToNumber(seconds); else let s be 0.
    let s = argCount >= 6 ? To.ToNumber(realm, seconds) : 0;

    // 7. If ms is supplied, let milli be ? ToNumber(ms); else let milli be 0.
    let milli = argCount >= 7 ? To.ToNumber(realm, ms) : 0;

    // 8. If y is not NaN and 0 ≤ ToInteger(y) ≤ 99, let yr be 1900+ToInteger(y); otherwise, let yr be y.
    let yr =
      !isNaN(y) && To.ToInteger(realm, y) >= 0 && To.ToInteger(realm, y) <= 99 ? 1900 + To.ToInteger(realm, y) : y;

    // 9. Return TimeClip(MakeDate(MakeDay(yr, m, dt), MakeTime(h, min, s, milli))).
    return TimeClip(realm, MakeDate(realm, MakeDay(realm, yr, m, dt), MakeTime(realm, h, min, s, milli)));
  });

  return func;
}
