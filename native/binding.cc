#include <napi.h>
#include <node_api.h>

#include "koda_binary.h"
#include "koda_parse.h"
#include "koda_value.h"

namespace koda {

static Napi::Value ValueToNapi(const Value& v, const Napi::Env& env) {
  switch (v.type) {
    case Value::Type::Null:
      return env.Null();
    case Value::Type::Bool:
      return Napi::Boolean::New(env, v.b);
    case Value::Type::Int:
      return Napi::Number::New(env, static_cast<double>(v.i));
    case Value::Type::Float:
      return Napi::Number::New(env, v.d);
    case Value::Type::String:
      return Napi::String::New(env, v.s);
    case Value::Type::Array: {
      Napi::Array arr = Napi::Array::New(env, v.arr.size());
      for (size_t i = 0; i < v.arr.size(); ++i)
        arr[static_cast<uint32_t>(i)] = ValueToNapi(v.arr[i], env);
      return arr;
    }
    case Value::Type::Object: {
      Napi::Object obj = Napi::Object::New(env);
      for (const auto& p : v.obj)
        obj.Set(p.first, ValueToNapi(p.second, env));
      return obj;
    }
  }
  return env.Null();
}

static Value NapiToValue(const Napi::Value& val) {
  if (val.IsNull() || val.IsUndefined()) return Value::null_val();
  if (val.IsBoolean()) return Value::bool_val(val.As<Napi::Boolean>().Value());
  if (val.IsNumber()) {
    Napi::Number n = val.As<Napi::Number>();
    double d = n.DoubleValue();
    if (d >= -9007199254740992.0 && d <= 9007199254740992.0) {
      int64_t i = static_cast<int64_t>(d);
      if (static_cast<double>(i) == d) return Value::int_val(i);
    }
    return Value::float_val(d);
  }
  if (val.IsString()) return Value::string_val(val.As<Napi::String>().Utf8Value());
  if (val.IsArray()) {
    Value v;
    v.type = Value::Type::Array;
    Napi::Array arr = val.As<Napi::Array>();
    for (uint32_t i = 0; i < arr.Length(); ++i)
      v.arr.push_back(NapiToValue(arr[i]));
    return v;
  }
  if (val.IsObject()) {
    Value v;
    v.type = Value::Type::Object;
    Napi::Object obj = val.As<Napi::Object>();
    Napi::Array keys = obj.GetPropertyNames();
    for (uint32_t i = 0; i < keys.Length(); ++i) {
      Napi::Value k = keys[i];
      std::string key = k.As<Napi::String>().Utf8Value();
      v.obj.emplace_back(key, NapiToValue(obj.Get(key)));
    }
    return v;
  }
  return Value::null_val();
}

static Napi::Value NativeParse(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected string").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string text = info[0].As<Napi::String>().Utf8Value();
  size_t max_depth = 256;
  if (info.Length() >= 2 && info[1].IsObject()) {
    Napi::Object opts = info[1].As<Napi::Object>();
    if (opts.Has("maxDepth")) {
      Napi::Value v = opts.Get("maxDepth");
      if (v.IsNumber()) max_depth = static_cast<size_t>(v.As<Napi::Number>().Uint32Value());
    }
  }
  try {
    Value v = parse(text, max_depth);
    return ValueToNapi(v, env);
  } catch (const std::exception& e) {
    Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
    return env.Null();
  }
}

static Napi::Value NativeStringify(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Expected value").ThrowAsJavaScriptException();
    return env.Null();
  }
  try {
    Value v = NapiToValue(info[0]);
    return Napi::String::New(env, stringify(v));
  } catch (const std::exception& e) {
    Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
    return env.Null();
  }
}

static Napi::Value NativeEncode(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Expected value").ThrowAsJavaScriptException();
    return env.Null();
  }
  size_t max_depth = 256;
  if (info.Length() >= 2 && info[1].IsObject()) {
    Napi::Object opts = info[1].As<Napi::Object>();
    if (opts.Has("maxDepth") && opts.Get("maxDepth").IsNumber())
      max_depth = static_cast<size_t>(opts.Get("maxDepth").As<Napi::Number>().Uint32Value());
  }
  try {
    Value v = NapiToValue(info[0]);
    std::vector<uint8_t> buf = encode(v, max_depth);
    Napi::Buffer<uint8_t> out = Napi::Buffer<uint8_t>::Copy(env, buf.data(), buf.size());
    return out;
  } catch (const std::exception& e) {
    Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
    return env.Null();
  }
}

static Napi::Value NativeDecode(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "Expected Buffer").ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Buffer<uint8_t> buf = info[0].As<Napi::Buffer<uint8_t>>();
  size_t max_depth = 256;
  size_t max_dict = 65536;
  size_t max_str = 1000000;
  if (info.Length() >= 2 && info[1].IsObject()) {
    Napi::Object opts = info[1].As<Napi::Object>();
    if (opts.Has("maxDepth") && opts.Get("maxDepth").IsNumber())
      max_depth = static_cast<size_t>(opts.Get("maxDepth").As<Napi::Number>().Uint32Value());
    if (opts.Has("maxDictionarySize") && opts.Get("maxDictionarySize").IsNumber())
      max_dict = static_cast<size_t>(opts.Get("maxDictionarySize").As<Napi::Number>().Uint32Value());
    if (opts.Has("maxStringLength") && opts.Get("maxStringLength").IsNumber())
      max_str = static_cast<size_t>(opts.Get("maxStringLength").As<Napi::Number>().Uint32Value());
  }
  try {
    Value v = decode(buf.Data(), buf.ByteLength(), max_depth, max_dict, max_str);
    return ValueToNapi(v, env);
  } catch (const std::exception& e) {
    Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
    return env.Null();
  }
}

}  // namespace koda

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("parse", Napi::Function::New(env, koda::NativeParse));
  exports.Set("stringify", Napi::Function::New(env, koda::NativeStringify));
  exports.Set("encode", Napi::Function::New(env, koda::NativeEncode));
  exports.Set("decode", Napi::Function::New(env, koda::NativeDecode));
  return exports;
}

NODE_API_MODULE(koda_js, Init)
