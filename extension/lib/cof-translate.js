(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const diag = cof.diag || (() => {});

  async function translateWithGoogle(text, targetLang, apiKey) {
    try {
      const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: text,
          target: targetLang,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Google Translate API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      return data.data?.translations?.[0]?.translatedText || text;
    } catch (e) {
      diag("translateGoogleError", String(e));
      throw e;
    }
  }

  async function translateWithMicrosoft(text, targetLang, apiKey, region) {
    try {
      const url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${encodeURIComponent(targetLang)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": apiKey,
          "Ocp-Apim-Subscription-Region": region || "global",
          "Content-Type": "application/json",
        },
        body: JSON.stringify([{ text }]),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Microsoft Translator API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      return data[0]?.translations?.[0]?.text || text;
    } catch (e) {
      diag("translateMicrosoftError", String(e));
      throw e;
    }
  }

  async function translateWithGoogleFree(text, targetLang) {
    try {
      // Google Translate free web endpoint (like TWP uses)
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Google Translate free endpoint error: ${response.status}`);
      }

      const data = await response.json();
      // Response format: [[["translated text", null, null, 0]]]
      if (Array.isArray(data) && data[0] && Array.isArray(data[0]) && data[0][0] && Array.isArray(data[0][0])) {
        return data[0][0][0] || text;
      }
      return text;
    } catch (e) {
      diag("translateGoogleFreeError", String(e));
      throw e;
    }
  }

  async function translateWithMicrosoftFree(text, targetLang) {
    try {
      // Microsoft Translator free web endpoint (like TWP uses)
      // Using Bing Translator web endpoint
      const url = `https://api.translator.microsoft.com/translate?api-version=3.0&to=${encodeURIComponent(targetLang)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify([{ Text: text }]),
      });

      if (!response.ok) {
        // If free endpoint doesn't work, try alternative approach
        throw new Error(`Microsoft Translator free endpoint error: ${response.status}`);
      }

      const data = await response.json();
      return data[0]?.translations?.[0]?.text || text;
    } catch (e) {
      diag("translateMicrosoftFreeError", String(e));
      throw e;
    }
  }

  async function translateWithChatGPT(text, targetLang, apiKey, embeddings, frequency) {
    try {
      const url = "https://api.openai.com/v1/chat/completions";
      const prompt = `Translate the following text to ${targetLang}. Preserve formatting, code blocks, and formulas. Only translate the text content, not code or formulas.\n\nText to translate:\n${text}`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`ChatGPT API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || text;
    } catch (e) {
      diag("translateChatGPTError", String(e));
      throw e;
    }
  }

  async function translateWithGemini(text, targetLang, apiKey, embeddings, frequency) {
    try {
      // Use gemini-1.5-flash (faster) or gemini-1.5-pro (more capable)
      // Use v1 API instead of v1beta for newer models
      const model = "gemini-1.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const prompt = `Translate the following text to ${targetLang}. Preserve formatting, code blocks, and formulas. Only translate the text content, not code or formulas.\n\nText to translate:\n${text}`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || text;
    } catch (e) {
      diag("translateGeminiError", String(e));
      throw e;
    }
  }

  async function translateWithPollinations(text, targetLang, apiKey, embeddings, frequency, customEndpoint) {
    try {
      // Pollinations API - uses text.pollinations.ai endpoint
      // Format: GET request with prompt in URL (URL-encoded)
      const prompt = `Translate the following text to ${targetLang}. Preserve formatting, code blocks, and formulas. Only translate the text content, not code or formulas.\n\nText to translate:\n${text}`;
      
      let url;
      if (customEndpoint) {
        url = customEndpoint;
      } else {
        // Use Pollinations text API endpoint - URL encode the prompt
        url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}`;
      }

      const headers = {};
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      // Pollinations text API uses GET requests by default
      const response = await fetch(url, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Pollinations API error: ${response.status} ${error.substring(0, 200)}`);
      }

      // Pollinations returns text directly (not JSON)
      const responseText = await response.text();
      
      // Try to parse as JSON first, if that fails, use text directly
      try {
        const data = JSON.parse(responseText);
        return data.text || data.result || data.content || data.response || responseText;
      } catch {
        // If not JSON, return text directly (trimmed)
        return responseText.trim() || text;
      }
    } catch (e) {
      diag("translatePollinationsError", String(e));
      throw e;
    }
  }

  async function translateWithCustomAPI(text, targetLang, config) {
    try {
      const { endpoint, method = "POST", headers = {}, payloadFormat = {} } = config;
      if (!endpoint) throw new Error("Custom API endpoint not configured");

      const body = payloadFormat.template
        ? payloadFormat.template.replace("{{text}}", text).replace("{{lang}}", targetLang)
        : JSON.stringify({ text, targetLang, ...payloadFormat });

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: method !== "GET" ? body : undefined,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Custom API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      return data.text || data.translatedText || data.result || text;
    } catch (e) {
      diag("translateCustomAPIError", String(e));
      throw e;
    }
  }

  async function translateFormulas(formulas, service, apiKey, targetLang, customConfig) {
    if (!formulas || formulas.length === 0) return formulas;

    const translatedFormulas = [];
    for (const formula of formulas) {
      try {
        let translated;
        if (service === "chatgpt") {
          translated = await translateWithChatGPT(formula, targetLang, apiKey, null, null);
        } else if (service === "gemini") {
          translated = await translateWithGemini(formula, targetLang, apiKey, null, null);
        } else if (service === "pollinations") {
          translated = await translateWithPollinations(formula, targetLang, apiKey, null, null, customConfig?.endpoint);
        } else if (service === "custom") {
          translated = await translateWithCustomAPI(formula, targetLang, customConfig);
        } else {
          translated = formula; // Don't translate with Google/Microsoft
        }
        translatedFormulas.push(translated);
      } catch (e) {
        diag("translateFormulaError", String(e));
        translatedFormulas.push(formula); // Fallback to original
      }
    }
    return translatedFormulas;
  }

  async function translate(content, targetLang, service, config, embeddings, frequency, anchors) {
    try {
      const { apiKeys, customApi, translateFormulas } = config;
      const apiKey = apiKeys[service] || "";

      // Google and Microsoft can work without API keys using free endpoints
      if (!apiKey && service !== "pollinations" && service !== "google" && service !== "microsoft" && service !== "google-free" && service !== "microsoft-free") {
        throw new Error(`API key not configured for ${service}`);
      }

      let translated;

      switch (service) {
        case "google-free":
          translated = await translateWithGoogleFree(content, targetLang);
          break;
        case "google":
          translated = apiKey
            ? await translateWithGoogle(content, targetLang, apiKey)
            : await translateWithGoogleFree(content, targetLang);
          break;
        case "microsoft-free":
          translated = await translateWithMicrosoftFree(content, targetLang);
          break;
        case "microsoft":
          translated = apiKey
            ? await translateWithMicrosoft(content, targetLang, apiKey, customApi.region)
            : await translateWithMicrosoftFree(content, targetLang);
          break;
        case "chatgpt":
          translated = await translateWithChatGPT(content, targetLang, apiKey, embeddings, frequency);
          break;
        case "gemini":
          translated = await translateWithGemini(content, targetLang, apiKey, embeddings, frequency);
          break;
        case "pollinations":
          translated = await translateWithPollinations(content, targetLang, apiKey, embeddings, frequency, customApi.endpoint);
          break;
        case "custom":
          translated = await translateWithCustomAPI(content, targetLang, customApi);
          break;
        default:
          throw new Error(`Unknown translation service: ${service}`);
      }

      return translated;
    } catch (e) {
      diag("translateError", String(e));
      throw e;
    }
  }

  cof.translate = {
    translate,
    translateWithGoogle,
    translateWithGoogleFree,
    translateWithMicrosoft,
    translateWithMicrosoftFree,
    translateWithChatGPT,
    translateWithGemini,
    translateWithPollinations,
    translateWithCustomAPI,
    translateFormulas,
  };
})();

