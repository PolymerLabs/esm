import GenericObject from "../generic/object.js"
import Loader from "../loader.js"
import OwnProxy from "../own/proxy.js"

import copyProperty from "./copy-property.js"
import getPrototypeOf from "./get-prototype-of.js"
import has from "./has.js"
import isObjectLike from "./is-object-like.js"
import nativeTrap from "./native-trap.js"
import setPrototypeOf from "./set-prototype-of.js"
import shared from "../shared.js"
import shimFunctionPrototypeToString from "../shim/function-prototype-to-string.js"
import unwrapOwnProxy from "./unwrap-own-proxy.js"

function init() {
  function maskFunction(func, source) {
    if (typeof source !== "function") {
      return func
    }

    const cache = shared.memoize.utilMaskFunction

    let cached = cache.get(func)

    if (cached !== void 0) {
      return cached.proxy
    }

    cached = cache.get(source)

    if (cached !== void 0) {
      source = cached.source
    }

    const proxy = new OwnProxy(func, {
      get: (func, name, receiver) => {
        if (name === "toString" &&
            ! has(func, "toString")) {
          return cached.toString
        }

        if (receiver === proxy) {
          receiver = func
        }

        return Reflect.get(func, name, receiver)
      }
    })

    const toString = new OwnProxy(func.toString, {
      apply: nativeTrap((_toString, thisArg, args) => {
        if (! Loader.state.package.default.options.debug &&
            typeof thisArg === "function" &&
            unwrapOwnProxy(thisArg) === func) {
          thisArg = cached.source
        }

        return Reflect.apply(_toString, thisArg, args)
      })
    })

    copyProperty(func, source, "name")
    setPrototypeOf(func, getPrototypeOf(source))

    const sourceProto = has(source, "prototype") ? source.prototype : void 0

    if (isObjectLike(sourceProto)) {
      let proto = has(func, "prototype") ? func.prototype : void 0

      if (! isObjectLike(proto)) {
        proto = GenericObject.create()
        func.prototype = proto
      }

      proto.constructor = proxy
      setPrototypeOf(proto, getPrototypeOf(sourceProto))
    } else {
      const descriptor = Reflect.getOwnPropertyDescriptor(source, "prototype")

      if (descriptor === void 0) {
        Reflect.deleteProperty(func, "prototype")
      } else {
        Reflect.defineProperty(func, "prototype", descriptor)
      }
    }

    cached = {
      proxy,
      source,
      toString
    }

    cache
      .set(func, cached)
      .set(proxy, cached)

    return proxy
  }

  shimFunctionPrototypeToString.enable(shared.safeGlobal)

  return maskFunction
}

export default shared.inited
  ? shared.module.utilMaskFunction
  : shared.module.utilMaskFunction = init()
