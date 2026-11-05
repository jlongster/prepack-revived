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
import { AbstractValue, StringValue, ObjectValue, NumberValue } from "../../values/index.js";
import { Placeholders } from "../../utils/PreludeGenerator.js";
import { lookupTimezoneOffsetAssumption } from "../env/assumptions.js";
import {
  Invoke,
  MakeTime,
  thisTimeValue,
  msFromTime,
  TimeClip,
  TimeWithinDay,
  MakeDay,
  YearFromTime,
  DateFromTime,
  MakeDate,
  ToDateString,
  HourFromTime,
  MinFromTime,
  Day,
  SecFromTime,
  WeekDay,
  LocalTime,
  MonthFromTime,
  msPerMinute,
  UTC,
} from "../../methods/index.js";
import { To } from "../../singletons";
import invariant from "../../invariant.js";

export default function(realm: Realm, obj: ObjectValue): void {
  function defineLocalGetter(name: string, computeFromLocalTime: (t: number, localTime: number) => number): void {
    obj.defineNativeMethod(name, 0, context => {
      let tv = thisTimeValue(realm, context);
      if (tv instanceof NumberValue) {
        let t = tv.value;
        if (isNaN(t)) return realm.intrinsics.NaN;
        if (!realm.useAbstractInterpretation || realm.closedWorld) {
          return new NumberValue(realm, computeFromLocalTime(t, LocalTime(realm, t)));
        }
        let assumedOffset = lookupTimezoneOffsetAssumption(realm, t);
        if (assumedOffset !== undefined) {
          let localTime = t - assumedOffset * msPerMinute;
          return new NumberValue(realm, computeFromLocalTime(t, localTime));
        }
        return AbstractValue.createTemporalFromTemplate(realm, `(new global.Date(A)).${name}()`, NumberValue, [tv], {
          isPure: true,
          skipInvariant: true,
        });
      }
      if (realm.useAbstractInterpretation && tv instanceof AbstractValue && !tv.mightNotBeNumber()) {
        return AbstractValue.createTemporalFromTemplate(realm, `(new global.Date(A)).${name}()`, NumberValue, [tv], {
          isPure: true,
          skipInvariant: true,
        });
      }
      let t = tv.throwIfNotConcreteNumber().value;
      if (isNaN(t)) return realm.intrinsics.NaN;
      return new NumberValue(realm, computeFromLocalTime(t, LocalTime(realm, t)));
    });
  }

  function defineUTCGetter(name: string, computeFromUTC: (t: number) => number): void {
    obj.defineNativeMethod(name, 0, context => {
      let tv = thisTimeValue(realm, context);
      if (realm.useAbstractInterpretation && tv instanceof AbstractValue && !tv.mightNotBeNumber()) {
        let res = AbstractValue.createFromTemplate(realm, `(new global.Date(A)).${name}()`, NumberValue, [tv]);
        return AbstractValue.convertToTemporalIfArgsAreTemporal(realm, res, [tv]);
      }
      let t = tv.throwIfNotConcreteNumber().value;
      if (isNaN(t)) return realm.intrinsics.NaN;
      return new NumberValue(realm, computeFromUTC(t));
    });
  }

  // ECMA262 20.3.4.2 - 20.3.4.9
  defineLocalGetter("getDate", (t, lt) => DateFromTime(realm, lt));
  defineLocalGetter("getDay", (t, lt) => WeekDay(realm, lt));
  defineLocalGetter("getFullYear", (t, lt) => YearFromTime(realm, lt));
  defineLocalGetter("getHours", (t, lt) => HourFromTime(realm, lt));
  defineLocalGetter("getMilliseconds", (t, lt) => msFromTime(realm, lt));
  defineLocalGetter("getMinutes", (t, lt) => MinFromTime(realm, lt));
  defineLocalGetter("getMonth", (t, lt) => MonthFromTime(realm, lt));
  defineLocalGetter("getSeconds", (t, lt) => SecFromTime(realm, lt));

  // ECMA262 20.3.4.10
  obj.defineNativeMethod("getTime", 0, context => {
    // 1. Return ? thisTimeValue(this value).
    return thisTimeValue(realm, context);
  });

  // ECMA262 20.3.4.11
  defineLocalGetter("getTimezoneOffset", (t, lt) => {
    let diff = (t - lt) / msPerMinute;
    return diff === 0 ? 0 : diff;
  });

  // ECMA262 20.3.4.12 - 20.3.4.19
  defineUTCGetter("getUTCDate", t => DateFromTime(realm, t));
  defineUTCGetter("getUTCDay", t => WeekDay(realm, t));
  defineUTCGetter("getUTCFullYear", t => YearFromTime(realm, t));
  defineUTCGetter("getUTCHours", t => HourFromTime(realm, t));
  defineUTCGetter("getUTCMilliseconds", t => msFromTime(realm, t));
  defineUTCGetter("getUTCMinutes", t => MinFromTime(realm, t));
  defineUTCGetter("getUTCMonth", t => MonthFromTime(realm, t));
  defineUTCGetter("getUTCSeconds", t => SecFromTime(realm, t));

  // ECMA262 20.3.4.20
  obj.defineNativeMethod("setDate", 1, (context, [date]) => {
    // 1. Let t be LocalTime(? thisTimeValue(this value)).
    let t = LocalTime(realm, thisTimeValue(realm, context).throwIfNotConcreteNumber().value);
    invariant(context instanceof ObjectValue);

    // 2. Let dt be ? ToNumber(date).
    let dt = To.ToNumber(realm, date);

    // 3. Let newDate be MakeDate(MakeDay(YearFromTime(t), MonthFromTime(t), dt), TimeWithinDay(t)).
    let newDate = MakeDate(
      realm,
      MakeDay(realm, YearFromTime(realm, t), MonthFromTime(realm, t), dt),
      TimeWithinDay(realm, t)
    );

    // 4. Let u be TimeClip(UTC(newDate)).
    let u = TimeClip(realm, UTC(realm, newDate));

    // 5. Set the [[DateValue]] internal slot of this Date object to u.
    context.$DateValue = u;

    // 6. Return u.
    return u;
  });

  // ECMA262 20.3.4.21
  obj.defineNativeMethod("setFullYear", 3, (context, [year, month, date], argCount) => {
    // 1. Let t be ? thisTimeValue(this value).
    let t = thisTimeValue(realm, context).throwIfNotConcreteNumber().value;
    invariant(context instanceof ObjectValue);

    // 2. If t is NaN, let t be +0; otherwise, let t be LocalTime(t).
    t = isNaN(t) ? +0 : LocalTime(realm, t);

    // 3. Let y be ? ToNumber(year).
    let y = To.ToNumber(realm, year);

    // 4. If month is not specified, let m be MonthFromTime(t); otherwise, let m be ? ToNumber(month).
    let m = argCount >= 2 ? To.ToNumber(realm, month) : MonthFromTime(realm, t);

    // 5. If date is not specified, let dt be DateFromTime(t); otherwise, let dt be ? ToNumber(date).
    let dt = argCount >= 3 ? To.ToNumber(realm, date) : DateFromTime(realm, t);

    // 6. Let newDate be MakeDate(MakeDay(y, m, dt), TimeWithinDay(t)).
    let newDate = MakeDate(realm, MakeDay(realm, y, m, dt), TimeWithinDay(realm, t));

    // 7. Let u be TimeClip(UTC(newDate)).
    let u = TimeClip(realm, UTC(realm, newDate));

    // 8. Set the [[DateValue]] internal slot of this Date object to u.
    context.$DateValue = u;

    // 9. Return u.
    return u;
  });

  // ECMA262 20.3.4.22
  obj.defineNativeMethod("setHours", 4, (context, [hour, min, sec, ms], argCount) => {
    // 1. Let t be LocalTime(? thisTimeValue(this value)).
    let t = LocalTime(realm, thisTimeValue(realm, context).throwIfNotConcreteNumber().value);
    invariant(context instanceof ObjectValue);

    // 2. Let h be ? ToNumber(hour).
    let h = To.ToNumber(realm, hour);

    // 3. If min is not specified, let m be MinFromTime(t); otherwise, let m be ? ToNumber(min).
    let m = argCount >= 2 ? To.ToNumber(realm, min) : MinFromTime(realm, t);

    // 4. If sec is not specified, let s be SecFromTime(t); otherwise, let s be ? ToNumber(sec).
    let s = argCount >= 3 ? To.ToNumber(realm, sec) : SecFromTime(realm, t);

    // 5. If ms is not specified, let milli be msFromTime(t); otherwise, let milli be ? ToNumber(ms).
    let milli = argCount >= 4 ? To.ToNumber(realm, ms) : msFromTime(realm, t);

    // 6. Let date be MakeDate(Day(t), MakeTime(h, m, s, milli)).
    let date = MakeDate(realm, Day(realm, t), MakeTime(realm, h, m, s, milli));

    // 7. Let u be TimeClip(UTC(date)).
    let u = TimeClip(realm, UTC(realm, date));

    // 8. Set the [[DateValue]] internal slot of this Date object to u.
    context.$DateValue = u;

    // 9. Return u.
    return u;
  });

  // ECMA262 20.3.4.23
  obj.defineNativeMethod("setMilliseconds", 1, (context, [_ms]) => {
    let ms = _ms;
    // 1. Let t be LocalTime(? thisTimeValue(this value)).
    let t = LocalTime(realm, thisTimeValue(realm, context).throwIfNotConcreteNumber().value);
    invariant(context instanceof ObjectValue);

    // 2. Let ms be ? ToNumber(ms).
    ms = To.ToNumber(realm, ms);

    // 3. Let time be MakeTime(HourFromTime(t), MinFromTime(t), SecFromTime(t), ms).
    let time = MakeTime(realm, HourFromTime(realm, t), MinFromTime(realm, t), SecFromTime(realm, t), ms);

    // 4. Let u be TimeClip(UTC(MakeDate(Day(t), time))).
    let u = TimeClip(realm, UTC(realm, MakeDate(realm, Day(realm, t), time)));

    // 5. Set the [[DateValue]] internal slot of this Date object to u.
    context.$DateValue = u;

    // 6. Return u.
    return u;
  });

  // ECMA262 20.3.4.24
  obj.defineNativeMethod("setMinutes", 3, (context, [min, sec, ms], argCount) => {
    // 1. Let t be LocalTime(? thisTimeValue(this value)).
    let t = LocalTime(realm, thisTimeValue(realm, context).throwIfNotConcreteNumber().value);
    invariant(context instanceof ObjectValue);

    // 2. Let m be ? ToNumber(min).
    let m = To.ToNumber(realm, min);

    // 3. If sec is not specified, let s be SecFromTime(t); otherwise, let s be ? ToNumber(sec).
    let s = argCount >= 2 ? To.ToNumber(realm, sec) : SecFromTime(realm, t);

    // 4. If ms is not specified, let milli be msFromTime(t); otherwise, let milli be ? ToNumber(ms).
    let milli = argCount >= 3 ? To.ToNumber(realm, ms) : msFromTime(realm, t);

    // 5. Let date be MakeDate(Day(t), MakeTime(HourFromTime(t), m, s, milli)).
    let date = MakeDate(realm, Day(realm, t), MakeTime(realm, HourFromTime(realm, t), m, s, milli));

    // 6. Let u be TimeClip(UTC(date)).
    let u = TimeClip(realm, UTC(realm, date));

    // 7. Set the [[DateValue]] internal slot of this Date object to u.
    context.$DateValue = u;

    // 8. Return u.
    return u;
  });

  // ECMA262 20.3.4.25
  obj.defineNativeMethod("setMonth", 2, (context, [month, date], argCount) => {
    // 1. Let t be LocalTime(? thisTimeValue(this value)).
    let t = LocalTime(realm, thisTimeValue(realm, context).throwIfNotConcreteNumber().value);
    invariant(context instanceof ObjectValue);

    // 2. Let m be ? ToNumber(month).
    let m = To.ToNumber(realm, month);

    // 3. If date is not specified, let dt be DateFromTime(t); otherwise, let dt be ? ToNumber(date).
    let dt = argCount >= 2 ? To.ToNumber(realm, date) : DateFromTime(realm, t);

    // 4. Let newDate be MakeDate(MakeDay(YearFromTime(t), m, dt), TimeWithinDay(t)).
    let newDate = MakeDate(realm, MakeDay(realm, YearFromTime(realm, t), m, dt), TimeWithinDay(realm, t));

    // 5. Let u be TimeClip(UTC(newDate)).
    let u = TimeClip(realm, UTC(realm, newDate));

    // 6. Set the [[DateValue]] internal slot of this Date object to u.
    context.$DateValue = u;

    // 7. Return u.
    return u;
  });

  // ECMA262 20.3.4.26
  obj.defineNativeMethod("setSeconds", 2, (context, [sec, ms], argCount) => {
    // 1. Let t be LocalTime(? thisTimeValue(this value)).
    let t = LocalTime(realm, thisTimeValue(realm, context).throwIfNotConcreteNumber().value);
    invariant(context instanceof ObjectValue);

    // 2. Let s be ? ToNumber(sec).
    let s = To.ToNumber(realm, sec);

    // 3. If ms is not specified, let milli be msFromTime(t); otherwise, let milli be ? ToNumber(ms).
    let milli = argCount >= 2 ? To.ToNumber(realm, ms) : msFromTime(realm, t);

    // 4. Let date be MakeDate(Day(t), MakeTime(HourFromTime(t), MinFromTime(t), s, milli)).
    let date = MakeDate(realm, Day(realm, t), MakeTime(realm, HourFromTime(realm, t), MinFromTime(realm, t), s, milli));

    // 5. Let u be TimeClip(UTC(date)).
    let u = TimeClip(realm, UTC(realm, date));

    // 6. Set the [[DateValue]] internal slot of this Date object to u.
    context.$DateValue = u;

    // 7. Return u.
    return u;
  });

  // ECMA262 20.3.4.27
  obj.defineNativeMethod("setTime", 1, (context, [time]) => {
    // 1. Perform ? thisTimeValue(this value).
    thisTimeValue(realm, context);
    invariant(context instanceof ObjectValue);

    // 2. Let t be ? ToNumber(time).
    let t = To.ToNumber(realm, time);

    // 3. Let v be TimeClip(t).
    let v = TimeClip(realm, t);

    // 4. Set the [[DateValue]] internal slot of this Date object to v.
    context.$DateValue = v;

    // 5. Return v.
    return v;
  });

  // ECMA262 20.3.4.28
  obj.defineNativeMethod("setUTCDate", 1, (context, [date]) => {
    // 1. Let t be ? thisTimeValue(this value).
    let t = thisTimeValue(realm, context).throwIfNotConcreteNumber().value;
    invariant(context instanceof ObjectValue);

    // 2. Let dt be ? ToNumber(date).
    let dt = To.ToNumber(realm, date);

    // 3. Let newDate be MakeDate(MakeDay(YearFromTime(t), MonthFromTime(t), dt), TimeWithinDay(t)).
    let newDate = MakeDate(
      realm,
      MakeDay(realm, YearFromTime(realm, t), MonthFromTime(realm, t), dt),
      TimeWithinDay(realm, t)
    );

    // 4. Let v be TimeClip(newDate).
    let v = TimeClip(realm, newDate);

    // 5. Set the [[DateValue]] internal slot of this Date object to v.
    context.$DateValue = v;

    // 6. Return v.
    return v;
  });

  // ECMA262 20.3.4.29
  obj.defineNativeMethod("setUTCFullYear", 3, (context, [year, month, date], argCount) => {
    // 1. Let t be ? thisTimeValue(this value).
    let t = thisTimeValue(realm, context).throwIfNotConcreteNumber().value;
    invariant(context instanceof ObjectValue);

    // 2. If t is NaN, let t be +0.
    if (isNaN(t)) t = +0;

    // 3. Let y be ? ToNumber(year).
    let y = To.ToNumber(realm, year);

    // 4. If month is not specified, let m be MonthFromTime(t); otherwise, let m be ? ToNumber(month).
    let m = argCount >= 2 ? To.ToNumber(realm, month) : MonthFromTime(realm, t);

    // 5. If date is not specified, let dt be DateFromTime(t); otherwise, let dt be ? ToNumber(date).
    let dt = argCount >= 3 ? To.ToNumber(realm, date) : DateFromTime(realm, t);

    // 6. Let newDate be MakeDate(MakeDay(y, m, dt), TimeWithinDay(t)).
    let newDate = MakeDate(realm, MakeDay(realm, y, m, dt), TimeWithinDay(realm, t));

    // 7. Let v be TimeClip(newDate).
    let v = TimeClip(realm, newDate);

    // 8. Set the [[DateValue]] internal slot of this Date object to v.
    context.$DateValue = v;

    // 9. Return v.
    return v;
  });

  // ECMA262 20.3.4.30
  obj.defineNativeMethod("setUTCHours", 4, (context, [hour, min, sec, ms], argCount) => {
    // 1. Let t be ? thisTimeValue(this value).
    let t = thisTimeValue(realm, context).throwIfNotConcreteNumber().value;
    invariant(context instanceof ObjectValue);

    // 2. Let h be ? ToNumber(hour).
    let h = To.ToNumber(realm, hour);

    // 3. If min is not specified, let m be MinFromTime(t); otherwise, let m be ? ToNumber(min).
    let m = argCount >= 2 ? To.ToNumber(realm, min) : MinFromTime(realm, t);

    // 4. If sec is not specified, let s be SecFromTime(t); otherwise, let s be ? ToNumber(sec).
    let s = argCount >= 3 ? To.ToNumber(realm, sec) : SecFromTime(realm, t);

    // 5. If ms is not specified, let milli be msFromTime(t); otherwise, let milli be ? ToNumber(ms).
    let milli = argCount >= 4 ? To.ToNumber(realm, ms) : msFromTime(realm, t);

    // 6. Let newDate be MakeDate(Day(t), MakeTime(h, m, s, milli)).
    let newDate = MakeDate(realm, Day(realm, t), MakeTime(realm, h, m, s, milli));

    // 7. Let v be TimeClip(newDate).
    let v = TimeClip(realm, newDate);

    // 8. Set the [[DateValue]] internal slot of this Date object to v.
    context.$DateValue = v;

    // 9. Return v.
    return v;
  });

  // ECMA262 20.3.4.31
  obj.defineNativeMethod("setUTCMilliseconds", 1, (context, [ms]) => {
    // 1. Let t be ? thisTimeValue(this value).
    let t = thisTimeValue(realm, context).throwIfNotConcreteNumber().value;
    invariant(context instanceof ObjectValue);

    // 2. Let milli be ? ToNumber(ms).
    let milli = To.ToNumber(realm, ms);

    // 3. Let time be MakeTime(HourFromTime(t), MinFromTime(t), SecFromTime(t), milli).
    let time = MakeTime(realm, HourFromTime(realm, t), MinFromTime(realm, t), SecFromTime(realm, t), milli);

    // 4. Let v be TimeClip(MakeDate(Day(t), time)).
    let v = TimeClip(realm, MakeDate(realm, Day(realm, t), time));

    // 5. Set the [[DateValue]] internal slot of this Date object to v.
    context.$DateValue = v;

    // 6. Return v.
    return v;
  });

  // ECMA262 20.3.4.32
  obj.defineNativeMethod("setUTCMinutes", 3, (context, [min, sec, ms], argCount) => {
    // 1. Let t be ? thisTimeValue(this value).
    let t = thisTimeValue(realm, context).throwIfNotConcreteNumber().value;
    invariant(context instanceof ObjectValue);

    // 2. Let m be ? ToNumber(min).
    let m = To.ToNumber(realm, min);

    // 3. If sec is not specified, let s be SecFromTime(t).
    let s;
    if (argCount < 2) {
      s = SecFromTime(realm, t);
    } else {
      // 4. Else,
      // a. Let s be ? ToNumber(sec).
      s = To.ToNumber(realm, sec);
    }

    // 5. If ms is not specified, let milli be msFromTime(t).
    let milli;
    if (argCount < 3) {
      milli = msFromTime(realm, t);
    } else {
      // 6. Else,
      // a. Let milli be ? ToNumber(ms).
      milli = To.ToNumber(realm, ms);
    }

    // 7. Let date be MakeDate(Day(t), MakeTime(HourFromTime(t), m, s, milli)).
    let date = MakeDate(realm, Day(realm, t), MakeTime(realm, HourFromTime(realm, t), m, s, milli));

    // 8. Let v be TimeClip(date).
    let v = TimeClip(realm, date);

    // 9. Set the [[DateValue]] internal slot of this Date object to v.
    context.$DateValue = v;

    // 10. Return v.
    return v;
  });

  // ECMA262 20.3.4.33
  obj.defineNativeMethod("setUTCMonth", 2, (context, [month, date], argCount) => {
    // 1. Let t be ? thisTimeValue(this value).
    let t = thisTimeValue(realm, context).throwIfNotConcreteNumber().value;
    invariant(context instanceof ObjectValue);

    // 2. Let m be ? ToNumber(month).
    let m = To.ToNumber(realm, month);

    // 3. If date is not specified, let dt be DateFromTime(t).
    let dt;
    if (argCount < 2) {
      dt = DateFromTime(realm, t);
    } else {
      // 4. Else,
      // a. Let dt be ? ToNumber(date).
      dt = To.ToNumber(realm, date);
    }

    // 5. Let newDate be MakeDate(MakeDay(YearFromTime(t), m, dt), TimeWithinDay(t)).
    let newDate = MakeDate(realm, MakeDay(realm, YearFromTime(realm, t), m, dt), TimeWithinDay(realm, t));

    // 6. Let v be TimeClip(newDate).
    let v = TimeClip(realm, newDate);

    // 7. Set the [[DateValue]] internal slot of this Date object to v.
    context.$DateValue = v;

    // 8. Return v.
    return v;
  });

  // ECMA262 20.3.4.34
  obj.defineNativeMethod("setUTCSeconds", 2, (context, [sec, ms], argCount) => {
    // 1. Let t be ? thisTimeValue(this value).
    let t = thisTimeValue(realm, context).throwIfNotConcreteNumber().value;
    invariant(context instanceof ObjectValue);

    // 2. Let s be ? ToNumber(sec).
    let s = To.ToNumber(realm, sec);

    // 3. If ms is not specified, let milli be msFromTime(t).
    let milli;
    if (argCount < 2) {
      milli = msFromTime(realm, t);
    } else {
      // 4. Else,
      // a. Let milli be ? ToNumber(ms).
      milli = To.ToNumber(realm, ms);
    }

    // 5. Let date be MakeDate(Day(t), MakeTime(HourFromTime(t), MinFromTime(t), s, milli)).
    let date = MakeDate(realm, Day(realm, t), MakeTime(realm, HourFromTime(realm, t), MinFromTime(realm, t), s, milli));

    // 6. Let v be TimeClip(date).
    let v = TimeClip(realm, date);

    // 7. Set the [[DateValue]] internal slot of this Date object to v.
    context.$DateValue = v;

    // 8. Return v.
    return v;
  });

  function defineLocaleDateMethod(name: "toLocaleDateString" | "toLocaleString" | "toLocaleTimeString"): void {
    obj.defineNativeMethod(name, 0, (context, args, argCount) => {
      let tv = thisTimeValue(realm, context);
      let passedArgs = args.slice(0, argCount);
      if (realm.useAbstractInterpretation) {
        if (tv instanceof AbstractValue && tv.mightNotBeNumber()) {
          tv.throwIfNotConcreteNumber();
        }
        if (tv instanceof NumberValue && isNaN(tv.value) && passedArgs.length === 0) {
          return new StringValue(realm, "Invalid Date");
        }
        let allInputs = [tv, ...passedArgs];
        let argParams = Placeholders.slice(1, 1 + passedArgs.length).join(", ");
        return AbstractValue.createTemporalFromTemplate(
          realm,
          `(new global.Date(A)).${name}(${argParams})`,
          StringValue,
          allInputs,
          { skipInvariant: true }
        );
      }
      let t = tv.throwIfNotConcreteNumber().value;
      let serializedArgs = passedArgs.map(a => a.serialize());
      let d = new Date(t);
      let formatted =
        name === "toLocaleDateString"
          ? d.toLocaleDateString(...serializedArgs)
          : name === "toLocaleTimeString"
          ? d.toLocaleTimeString(...serializedArgs)
          : d.toLocaleString(...serializedArgs);
      return new StringValue(realm, formatted);
    });
  }

  function defineLocalStringMethod(name: "toDateString" | "toTimeString"): void {
    obj.defineNativeMethod(name, 0, context => {
      let tv = thisTimeValue(realm, context);
      if (tv instanceof NumberValue && isNaN(tv.value)) {
        return new StringValue(realm, "Invalid Date");
      }
      if (realm.useAbstractInterpretation && !realm.closedWorld) {
        if (tv instanceof AbstractValue && tv.mightNotBeNumber()) tv.throwIfNotConcreteNumber();
        return AbstractValue.createTemporalFromTemplate(realm, `(new global.Date(A)).${name}()`, StringValue, [tv], {
          isPure: true,
          skipInvariant: true,
        });
      }
      let t = tv.throwIfNotConcreteNumber().value;
      let d = new Date(t);
      return new StringValue(realm, name === "toDateString" ? d.toDateString() : d.toTimeString());
    });
  }

  // ECMA262 20.3.4.35
  defineLocalStringMethod("toDateString");

  // ECMA262 20.3.4.36
  obj.defineNativeMethod("toISOString", 0, context => {
    let tv = thisTimeValue(realm, context);
    if (
      realm.useAbstractInterpretation &&
      realm.isInPureScope() &&
      tv instanceof AbstractValue &&
      !tv.mightNotBeNumber()
    ) {
      return AbstractValue.createTemporalFromTemplate(realm, "(new global.Date(A)).toISOString()", StringValue, [tv], {
        skipInvariant: true,
      });
    }
    let t = tv.throwIfNotConcreteNumber().value;
    if (!isFinite(t)) {
      throw realm.createErrorThrowCompletion(realm.intrinsics.RangeError);
    }

    return new StringValue(realm, new Date(t).toISOString());
  });

  // ECMA262 20.3.4.37
  obj.defineNativeMethod("toJSON", 1, (context, [key]) => {
    // 1. Let O be ? ToObject(this value).
    let O = To.ToObject(realm, context);

    // 2. Let tv be ? ToPrimitive(O, hint Number).
    let tv = To.ToPrimitive(realm, O.throwIfNotConcreteObject(), "number");

    // 3. If Type(tv) is Number and tv is not finite, return null.
    if (tv instanceof NumberValue && !isFinite(tv.value)) {
      return realm.intrinsics.null;
    }

    // 4. Return ? Invoke(O, "toISOString").
    return Invoke(realm, O, "toISOString");
  });

  // ECMA262 20.3.4.38 - 20.3.4.40
  defineLocaleDateMethod("toLocaleDateString");
  defineLocaleDateMethod("toLocaleString");
  defineLocaleDateMethod("toLocaleTimeString");

  // ECMA262 20.3.4.41
  obj.defineNativeMethod("toString", 0, context => {
    // 1. Let O be this Date object.
    let O = context;

    // 2. If O does not have a [[DateValue]] internal slot, then
    if (O instanceof ObjectValue && O.$DateValue === undefined) {
      return new StringValue(realm, "Invalid Date");
    }
    let tv = thisTimeValue(realm, O);
    if (tv instanceof NumberValue && isNaN(tv.value)) {
      return new StringValue(realm, "Invalid Date");
    }
    if (realm.useAbstractInterpretation && !realm.closedWorld) {
      if (tv instanceof AbstractValue && tv.mightNotBeNumber()) tv.throwIfNotConcreteNumber();
      return AbstractValue.createTemporalFromTemplate(realm, "(new global.Date(A)).toString()", StringValue, [tv], {
        isPure: true,
        skipInvariant: true,
      });
    }
    let t = tv.throwIfNotConcreteNumber().value;
    // 4. Return ToDateString(tv).
    return new StringValue(realm, ToDateString(realm, t));
  });

  // ECMA262 20.3.4.42
  defineLocalStringMethod("toTimeString");

  // ECMA262 20.3.4.43
  obj.defineNativeMethod("toUTCString", 0, context => {
    let tv = thisTimeValue(realm, context);
    if (realm.useAbstractInterpretation && tv instanceof AbstractValue && !tv.mightNotBeNumber()) {
      let res = AbstractValue.createFromTemplate(realm, "(new global.Date(A)).toUTCString()", StringValue, [tv]);
      return AbstractValue.convertToTemporalIfArgsAreTemporal(realm, res, [tv]);
    }
    let t = tv.throwIfNotConcreteNumber().value;
    if (isNaN(t)) return new StringValue(realm, "Invalid Date");
    return new StringValue(realm, new Date(t).toUTCString());
  });

  // ECMA262 20.3.4.44
  obj.defineNativeMethod("valueOf", 0, context => {
    // 1. Return ? thisTimeValue(this value).
    return thisTimeValue(realm, context);
  });

  // ECMA262 20.3.4.45
  obj.defineNativeMethod(
    realm.intrinsics.SymbolToPrimitive,
    1,
    (context, [_hint]) => {
      let hint = _hint;
      // 1. Let O be the this value.
      let O = context.throwIfNotConcrete();

      // 2. If Type(O) is not Object, throw a TypeError exception.
      if (!(O instanceof ObjectValue)) {
        throw realm.createErrorThrowCompletion(realm.intrinsics.TypeError, "Type(O) is not Object");
      }

      let tryFirst;
      hint = hint.throwIfNotConcrete();
      // 3. If hint is the String value "string" or the String value "default", then
      if (hint instanceof StringValue && (hint.value === "string" || hint.value === "default")) {
        // a. Let tryFirst be "string".
        tryFirst = "string";
      } else if (hint instanceof StringValue && hint.value === "number") {
        // 4. Else if hint is the String value "number", then
        // a. Let tryFirst be "number".
        tryFirst = "number";
      } else {
        // 5. Else, throw a TypeError exception.
        throw realm.createErrorThrowCompletion(realm.intrinsics.TypeError, "Type(O) is not Object");
      }

      // 6. Return ? OrdinaryToPrimitive(O, tryFirst).
      return To.OrdinaryToPrimitive(realm, O, tryFirst);
    },
    { writable: false }
  );

  // B.2.4.1
  defineLocalGetter("getYear", (t, lt) => YearFromTime(realm, lt) - 1900);

  // B.2.4.2
  obj.defineNativeMethod("setYear", 1, (context, [year]) => {
    // 1. Let t be ? thisTimeValue(this value).
    let t = thisTimeValue(realm, context).throwIfNotConcreteNumber().value;
    invariant(context instanceof ObjectValue);

    // 2. If t is NaN, let t be +0; otherwise, let t be LocalTime(t).
    t = isNaN(t) ? +0 : LocalTime(realm, t);

    // 3. Let y be ? ToNumber(year).
    let y = To.ToNumber(realm, year);

    // 4. If y is NaN, set the [[DateValue]] internal slot of this Date object to NaN and return NaN.
    if (isNaN(y)) {
      context.$DateValue = realm.intrinsics.NaN;
      return realm.intrinsics.NaN;
    }

    // 5. If y is not NaN and 0 ≤ To.ToInteger(y) ≤ 99, let yyyy be To.ToInteger(y) + 1900.
    let yyyy;
    if (To.ToInteger(realm, y) < 99) {
      yyyy = To.ToInteger(realm, y) + 1900;
    } else {
      // 6. Else, let yyyy be y.
      yyyy = y;
    }

    // 7. Let d be MakeDay(yyyy, MonthFromTime(t), DateFromTime(t)).
    let d = MakeDay(realm, yyyy, MonthFromTime(realm, t), DateFromTime(realm, t));

    // 8. Let date be UTC(MakeDate(d, TimeWithinDay(t))).
    let date = UTC(realm, MakeDate(realm, d, TimeWithinDay(realm, t)));

    // 9. Set the [[DateValue]] internal slot of this Date object to TimeClip(date).
    let dateValue = TimeClip(realm, date);
    context.$DateValue = dateValue;

    // 10. Return the value of the [[DateValue]] internal slot of this Date object.
    return dateValue;
  });

  // B.2.4.3
  obj.defineNativeProperty("toGMTString", obj.$Get("toUTCString", obj));
}
