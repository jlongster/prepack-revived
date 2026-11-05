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
import { AbstractValue, ObjectValue, AbstractObjectValue } from "../../values/index.js";
import { createAbstract } from "../prepack/utils.js";
import { Properties } from "../../singletons.js";
import invariant from "../../invariant";

const functions = [
  "getElementById",
  "getElementByTag",
  "getElementByClassName",
  "getElementByName",
  "getElementByTagName",
  "getElementByTagNameNS",
  "querySelector",
  "querySelectorAll",
  "createElement",
  "createDocumentFragment",
  "createTextNode",
];

export default function(realm: Realm): ObjectValue | AbstractValue {
  let optionalBrowserDoc = realm.isCompatibleWith("browser") && !realm.react.enabled;
  let docName = optionalBrowserDoc ? "global.document" : "document";
  // document object
  let document = new ObjectValue(realm, realm.intrinsics.ObjectPrototype, docName, false);

  // check if we can use abstracts
  if (realm.useAbstractInterpretation) {
    document.makeSimple("transitive");
    // common methods on document
    for (let name of functions) {
      let func = createAbstract(realm, "function", `${docName}.${name}`);
      Properties.Set(realm, document, name, func, false);
    }

    // document.body
    let body = new ObjectValue(realm, realm.intrinsics.ObjectPrototype, `${docName}.body`);
    body.makeSimple("transitive");
    Properties.Set(realm, document, "body", body, false);

    // In general browser/UMD bundles, `document` may be absent when loaded in Node/workers;
    // keep `document` non-nullish only when React DOM / fb-www / node-react mocks are active.
    if (optionalBrowserDoc) {
      return createAbstract(realm, document, docName, undefined, realm.intrinsics.undefined);
    }

    // make abstract
    let abstractObject = createAbstract(realm, document, docName);
    invariant(abstractObject instanceof AbstractObjectValue);
    return abstractObject;
  }
  return document;
}
