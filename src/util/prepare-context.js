import { Script } from "../safe/vm.js"

import { deprecate } from "../safe/util.js"
import getPrototypeOf from "./get-prototype-of.js"
import has from "./has.js"
import instanceOf from "./instance-of.js"
import isObjectLike from "./is-object-like.js"
import ownKeys from "./own-keys.js"
import setProperty from "./set-property.js"
import setPrototypeOf from "./set-prototype-of.js"
import shared from "../shared.js"

function init() {
  const possibleBuiltins = [
    "Array", "ArrayBuffer", "Atomics", "BigInt", "BigInt64Array",
    "BigUint64Array", "Boolean", "DataView", "Date", "Error", "EvalError",
    "Float32Array", "Float64Array", "Function", "Int16Array", "Int32Array",
    "Int8Array", "Map","Number", "Object", "Promise", "Proxy", "RangeError",
    "ReferenceError", "Reflect", "RegExp", "Set", "SharedArrayBuffer",
    "String", "Symbol", "SyntaxError", "TypeError", "URIError", "Uint16Array",
    "Uint32Array", "Uint8Array", "Uint8ClampedArray", "WeakMap", "WeakSet"
  ]

  const reassignableBuiltins = [
    "Buffer",
    "URL",
    "URLSearchParams",
    "clearImmediate",
    "clearInterval",
    "clearTimeout",
    "console",
    "global",
    "process",
    "setImmediate",
    "setInterval",
    "setTimeout"
  ]

  function prepareContext(context) {
    const { defaultGlobal } = shared

    if (context === defaultGlobal) {
      return context
    }

    const names = ownKeys(defaultGlobal)

    for (const name of names) {
      let descriptor

      if (name === "global") {
        descriptor = {
          configurable: true,
          enumerable: true,
          value: context,
          writable: true
        }
      } else if (name === "GLOBAL" ||
                 name === "root") {
        descriptor = getDeprecatedGlobalDescriptor(name, context)
      } else if (! Reflect.has(context, name)) {
        descriptor = Reflect.getOwnPropertyDescriptor(defaultGlobal, name)
      }

      if (descriptor !== void 0) {
        Reflect.defineProperty(context, name, descriptor)
      }
    }

    // For an unknown reason some `context` properties aren't accessible as
    // free global variables unless they're deleted and reassigned.
    for (const name of reassignableBuiltins) {
      const descriptor = Reflect.getOwnPropertyDescriptor(context, name)

      if (descriptor !== void 0 &&
          Reflect.deleteProperty(context, name)) {
        Reflect.defineProperty(context, name, descriptor)
      }
    }

    const descriptors = new Map

    for (const name of possibleBuiltins) {
      if (has(context, name)) {
        descriptors.set(name, Reflect.getOwnPropertyDescriptor(context, name))

        // Delete shadowed builtins to expose those of its realm.
        Reflect.deleteProperty(context, name)
      }
    }

    if (descriptors.size === 0) {
      return context
    }

    const realmBuiltins = new Script(
      "({" +
      (() => {
        const names = descriptors.keys()

        let status
        let code = ""

        do {
          status = names.next()

          code +=
            toBuiltinPropertySnippet(status.value) +
            (status.done ? "" : ",")
        } while (! status.done)

        return code
      })() +
      "})"
    ).runInContext(context)

    descriptors.forEach((descriptor, name) => {
      Reflect.defineProperty(context, name, descriptor)

      const builtin = context[name]
      const realmBuiltin = realmBuiltins[name]

      if (builtin === realmBuiltin ||
          ! isObjectLike(builtin) ||
          ! isObjectLike(realmBuiltin)) {
        return
      }

      if (name === "Error") {
        realmBuiltin.prepareStackTrace =
          (...args) => Reflect.apply(builtin.prepareStackTrace, builtin, args)
      } else if (name === "Object") {
        Reflect.defineProperty(builtin, Symbol.hasInstance, {
          configurable: true,
          value: function (instance) {
            if (this === builtin) {
              return instance instanceof realmBuiltin ||
                instanceOf(instance, builtin)
            }

            return instanceOf(instance, this)
          }
        })
      }

      if (typeof realmBuiltin === "function") {
        setPrototypeOf(realmBuiltin, getPrototypeOf(builtin))

        if (has(realmBuiltin, "prototype")) {
          const { prototype } = realmBuiltin

          if (isObjectLike(prototype)) {
            const builtinProto = builtin.prototype

            if (has(builtinProto, "constructor")) {
              prototype.constructor = builtinProto.constructor
            }

            setPrototypeOf(prototype, builtinProto)
          }
        }
      }
    })

    return context
  }

  function getDeprecatedGlobalDescriptor(name, context) {
    const depCode = "DEP0016"
    const depMessage = "'" + name + "' is deprecated, use 'global'"

    return {
      configurable: true,
      get: deprecate(() => context, depMessage, depCode),
      set: deprecate(function (value) {
        setProperty(this, name, value)
      }, depMessage, depCode)
    }
  }

  function toBuiltinPropertySnippet(name) {
    let snippet = name + ":"

    if (name === "Array") {
      snippet += "[].constructor"
    } else if (name === "BigInt") {
      snippet += "1n.constructor"
    } else if (name === "Boolean") {
      snippet += "true.constructor"
    } else if (name === "Function") {
      snippet += "(function () {}).constructor"
    } else if (name === "Number") {
      snippet += "1..constructor"
    } else if (name === "Object") {
      snippet += "({}).constructor"
    } else if (name === "RegExp") {
      snippet += "/./.constructor"
    } else if (name === "String") {
      snippet += '"".constructor'
    } else {
      snippet += "this." + name
    }

    return snippet
  }

  return prepareContext
}

export default shared.inited
  ? shared.module.utilPrepareContext
  : shared.module.utilPrepareContext = init()
