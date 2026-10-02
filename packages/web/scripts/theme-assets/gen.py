# Generates raw theme images with Gemini. Usage: gen.py <name> <model> <prompt>
import base64, json, os, sys, urllib.request
name, model, prompt = sys.argv[1], sys.argv[2], sys.argv[3]
key = os.environ["GEMINI_API_KEY"]
body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": sys.argv[4] if len(sys.argv) > 4 else "1:1"}}}
req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    data=json.dumps(body).encode(), headers={"x-goog-api-key": key, "content-type": "application/json"})
d = json.load(urllib.request.urlopen(req, timeout=180))
if "parts" not in d["candidates"][0].get("content", {}): sys.exit(f"no image: {d['candidates'][0].get('finishReason')} {d['candidates'][0].get('finishMessage', '')}")
for p in d["candidates"][0]["content"]["parts"]:
    if "inlineData" in p:
        ext = p["inlineData"]["mimeType"].split("/")[1].replace("jpeg", "jpg")
        path = f"{os.path.dirname(__file__)}/raw/{name}.{ext}"
        open(path, "wb").write(base64.b64decode(p["inlineData"]["data"]))
        print("wrote", path)
