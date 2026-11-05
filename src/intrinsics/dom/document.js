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
import { ObjectValue, AbstractObjectValue } from "../../values/index.js";
import { createAbstract } from "../prepack/utils.js";
import { Properties } from "../../singletons.js";
import invariant from "../../invariant";

const functions = [
  "getElementById",
  "getElementByTag",
  "getElementByClassName",
  "getElementsByClassName",
  "getElementByName",
  "getElementsByName",
  "getElementByTagName",
  "getElementsByTagName",
  "getElementByTagNameNS",
  "getElementsByTagNameNS",
  "querySelector",
  "querySelectorAll",
  "createElement",
  "createElementNS",
  "createDocumentFragment",
  "createTextNode",
  "createComment",
  "createEvent",
  "addEventListener",
  "removeEventListener",
];

export default function(realm: Realm): AbstractObjectValue | ObjectValue {
  // document object
  let document = new ObjectValue(realm, realm.intrinsics.ObjectPrototype, "document", false);

  // check if we can use abstracts
  if (realm.useAbstractInterpretation) {
    // common methods on document
    for (let name of functions) {
      let func = createAbstract(realm, "function", `document.${name}`);
      func.isEnvironmentValue = true;
      if (name === "createElement" || name === "createElementNS") {
        func.envMethodSpec = { r: "object", s: "HTMLElement" };
      } else if (name === "getElementById" || name === "querySelector") {
        func.envMethodSpec = { r: "object", s: "HTMLElement", n: true };
      }
      Properties.Set(realm, document, name, func, false);
    }

    // document.body, document.head, document.documentElement, document.childNodes
    for (let prop of ["body", "head", "documentElement", "childNodes"]) {
      let childObj = new ObjectValue(realm, realm.intrinsics.ObjectPrototype, `document.${prop}`);
      childObj.makePartial();
      childObj.makeSimple();
      Properties.Set(realm, document, prop, childObj, false);
    }

    document.makeSimple();
    // make abstract
    let abstractObject = createAbstract(realm, document, "document");
    invariant(abstractObject instanceof AbstractObjectValue);
    abstractObject.isEnvironmentValue = true;
    abstractObject.envShapeName = "Document";
    return abstractObject;
  }
  return document;
}
