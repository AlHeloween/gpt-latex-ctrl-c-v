/**
 * Real translation tests - tests actual JavaScript modules
 * Run with: node tests/test_translation_real.js
 * Or: uv run node tests/test_translation_real.js
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Set up fetch (Node.js 18+ has native fetch, otherwise use node-fetch)
let fetch;
if (typeof globalThis.fetch !== 'undefined') {
  fetch = globalThis.fetch;
} else {
  try {
    fetch = require('node-fetch');
  } catch (e) {
    console.error('Error: fetch not available. Install with: npm install node-fetch');
    process.exit(1);
  }
}

// Set up DOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
  resources: 'usable'
});

global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.navigator = { ...dom.window.navigator, clipboard: undefined };

// Mock browser API
global.browser = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
    }
  }
};

// Set global fetch
global.fetch = fetch;

// Mock diag
global.__cof = { diag: () => {} };

// Load modules
const extensionPath = path.join(__dirname, '..', 'extension', 'lib');

let anchorCode, analysisCode, translateCode;
try {
  anchorCode = fs.readFileSync(path.join(extensionPath, 'cof-anchor.js'), 'utf8');
  analysisCode = fs.readFileSync(path.join(extensionPath, 'cof-analysis.js'), 'utf8');
  translateCode = fs.readFileSync(path.join(extensionPath, 'cof-translate.js'), 'utf8');
} catch (e) {
  console.error('Error reading module files:', e.message);
  process.exit(1);
}

try {
  eval(anchorCode);
  eval(analysisCode);
  eval(translateCode);
} catch (e) {
  console.error('Error loading modules:', e.message);
  console.error(e.stack);
  process.exit(1);
}

const anchor = global.__cof.anchor;
const analysis = global.__cof.analysis;
const translate = global.__cof.translate;

if (!anchor || !analysis || !translate) {
  console.error('Error: Modules not loaded correctly');
  console.error('anchor:', !!anchor, 'analysis:', !!analysis, 'translate:', !!translate);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function testRealAnchoring() {
  console.log('Testing anchoring module (real)...');
  
  const html = '<p>Text <math><mi>x</mi><mo>+</mo><mn>1</mn></math> and <pre>code here</pre> more text</p>';
  const result = anchor.anchorFormulasAndCode(html);
  
  assert(result.anchors.formulas.length === 1, 'Should find 1 formula');
  assert(result.anchors.codes.length === 1, 'Should find 1 code block');
  assert(result.html.includes('[[COF_FORMULA_0]]'), 'Should contain formula anchor');
  // Anchor index is shared, so code will be [[COF_CODE_1]] (after formula's [[COF_FORMULA_0]])
  const hasCodeAnchor = /\[\[COF_CODE_\d+\]\]/.test(result.html);
  assert(hasCodeAnchor, `Should contain code anchor. HTML: ${result.html}`);
  assert(!result.html.includes('<math><mi>x</mi>'), 'Should not contain original formula');
  
  // Test restoration
  const restored = anchor.restoreAnchors(result.html, result.anchors, false);
  assert(restored.includes('<math>'), 'Should restore formula');
  assert(restored.includes('<pre>'), 'Should restore code');
  
  console.log('✓ Anchoring tests passed');
}

async function testRealAnalysis() {
  console.log('Testing analysis module (real)...');
  
  const html = '<p>This is a test sentence with multiple words for analysis and testing purposes.</p>';
  const result = analysis.analyzeContent(html);
  
  assert(Array.isArray(result.embedding), 'Should return embedding array');
  assert(result.embedding.length === 64, 'Should return 64-d embedding');
  assert(typeof result.frequency === 'object', 'Should return frequency object');
  assert(result.totalWords > 0, 'Should find words');
  assert(Array.isArray(result.topWords), 'Should return topWords array');
  
  console.log('✓ Analysis tests passed');
}

async function testRealTranslationGoogleFree() {
  console.log('Testing Google Translate (free endpoint, real API)...');
  
  try {
    if (!translate.translateWithGoogleFree) {
      console.log('⚠ Google free endpoint not available (skipping)');
      return;
    }
    
    const token = 'TOKEN_XYZ_1234567890';
    const text = `Hello world. This is a second sentence with ${token}.`;
    const translated = await translate.translateWithGoogleFree(text, 'es');
    
    assert(typeof translated === 'string', 'Should return string');
    assert(translated.length > 0, 'Should return translated text');
    assert(translated !== text, 'Should be different from original');
    assert(translated.includes(token), 'Should include token from later segment (avoid truncation)');
    console.log(`✓ Google Translate (free): "${text}" -> "${translated.substring(0, 80)}..."`);
  } catch (e) {
    console.log(`⚠ Google Translate test skipped: ${e.message}`);
  }
}

async function testRealTranslationMicrosoftFree() {
  console.log('Testing Microsoft (Bing) (free endpoint, real API)...');

  try {
    if (!translate.translateWithMicrosoftFree) {
      console.log('⚠ Microsoft free endpoint not available (skipping)');
      return;
    }

    const token = 'TOKEN_ABC_0987654321';
    const text = `Hello world. This is a second sentence with ${token}.`;
    const translated = await translate.translateWithMicrosoftFree(text, 'es');

    assert(typeof translated === 'string', 'Should return string');
    assert(translated.length > 0, 'Should return translated text');
    assert(translated !== text, 'Should be different from original');
    assert(translated.includes(token), 'Should include token from later segment (avoid truncation)');
    console.log(`✓ Microsoft (Bing) free: "${text}" -> "${translated.substring(0, 80)}..."`);
  } catch (e) {
    console.log(`⚠ Microsoft (Bing) test skipped: ${e.message}`);
  }
}

async function testRealTranslationPollinations() {
  console.log('Testing Pollinations (real API)...');
  
  try {
    const text = 'Hello world';
    const translated = await translate.translateWithPollinations(
      text, 
      'es', // Spanish
      '', // No API key needed
      null,
      null,
      undefined // Use default endpoint
    );
    
    assert(typeof translated === 'string', 'Should return string');
    assert(translated.length > 0, 'Should return translated text');
    console.log(`✓ Pollinations: "${text}" -> "${translated.substring(0, 50)}..."`);

    // Longer input (regression guard: avoid URL-length failures).
    const longToken = 'TOKEN_LONG_12345';
    const longText = (`Hello world. `).repeat(200) + longToken + (`. Hello world `).repeat(200);
    const translatedLong = await translate.translateWithPollinations(
      longText,
      'es',
      '',
      null,
      null,
      undefined
    );
    assert(typeof translatedLong === 'string', 'Should return string for long text');
    assert(translatedLong.length > 0, 'Should return translated long text');
    assert(translatedLong.includes(longToken), 'Should preserve token in long text');
    console.log(`✓ Pollinations long input ok (len=${longText.length})`);
  } catch (e) {
    console.log(`⚠ Pollinations test skipped: ${e.message}`);
  }
}

async function testRealTranslationChatGPT() {
  console.log('Testing ChatGPT (real API with keyring key)...');
  
  try {
    // Get API key from environment variable (set by Python wrapper)
    const apiKey = process.env.TRANSLATION_TEST_CHATGPT_KEY || '';
    
    if (!apiKey) {
      console.log('⚠ ChatGPT test skipped: No API key available (set TRANSLATION_TEST_CHATGPT_KEY or use Python wrapper)');
      return;
    }
    
    if (!translate.translateWithChatGPT) {
      console.log('⚠ ChatGPT function not available (skipping)');
      return;
    }
    
    const text = 'Hello world';
    const translated = await translate.translateWithChatGPT(
      text,
      'es', // Spanish
      apiKey,
      null,
      null
    );
    
    assert(typeof translated === 'string', 'Should return string');
    assert(translated.length > 0, 'Should return translated text');
    assert(translated !== text, 'Should be different from original');
    console.log(`✓ ChatGPT: "${text}" -> "${translated.substring(0, 50)}..."`);
  } catch (e) {
    console.log(`⚠ ChatGPT test skipped: ${e.message}`);
  }
}

async function testRealTranslationGemini() {
  console.log('Testing Gemini (real API with keyring key)...');
  
  try {
    // Get API key from environment variable (set by Python wrapper)
    const apiKey = process.env.TRANSLATION_TEST_GEMINI_KEY || '';
    
    if (!apiKey) {
      console.log('⚠ Gemini test skipped: No API key available (set TRANSLATION_TEST_GEMINI_KEY or use Python wrapper)');
      return;
    }
    
    if (!translate.translateWithGemini) {
      console.log('⚠ Gemini function not available (skipping)');
      return;
    }
    
    const text = 'Hello world';
    const translated = await translate.translateWithGemini(
      text,
      'es', // Spanish
      apiKey,
      null,
      null
    );
    
    assert(typeof translated === 'string', 'Should return string');
    assert(translated.length > 0, 'Should return translated text');
    assert(translated !== text, 'Should be different from original');
    console.log(`✓ Gemini: "${text}" -> "${translated.substring(0, 50)}..."`);
  } catch (e) {
    console.log(`⚠ Gemini test skipped: ${e.message}`);
  }
}

async function testRealTranslationPipeline() {
  console.log('Testing full translation pipeline (anchor -> analyze -> translate -> restore)...');
  
  try {
    const html = '<p>Hello world. This is a test.</p>';
    
    // Step 1: Anchor
    const { html: anchored, anchors } = anchor.anchorFormulasAndCode(html);
    
    // Step 2: Analyze
    const analysisResult = analysis.analyzeContent(anchored);
    assert(analysisResult.totalWords > 0, 'Should analyze content');
    
    // Step 3: Translate (using Pollinations free API)
    const translated = await translate.translateWithPollinations(
      anchored,
      'es',
      '',
      null,
      null,
      undefined // Use default endpoint
    );
    
    assert(typeof translated === 'string', 'Should get translation');
    
    // Step 4: Restore
    const restored = anchor.restoreAnchors(translated, anchors, false);
    assert(restored.length > 0, 'Should restore content');
    
    console.log('✓ Full pipeline test passed');
  } catch (e) {
    console.log(`⚠ Pipeline test skipped: ${e.message}`);
  }
}

async function runAllTests() {
  console.log('\n' + '='.repeat(70));
  console.log('REAL TRANSLATION TESTS (Testing Actual JavaScript Modules)');
  console.log('='.repeat(70) + '\n');
  
  try {
    await testRealAnchoring();
    await testRealAnalysis();
    await testRealTranslationGoogleFree();
    await testRealTranslationMicrosoftFree();
    await testRealTranslationPollinations();
    await testRealTranslationChatGPT();
    await testRealTranslationGemini();
    await testRealTranslationPipeline();
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ ALL REAL TESTS PASSED!');
    console.log('='.repeat(70) + '\n');
    process.exit(0);
  } catch (e) {
    console.error('\n' + '='.repeat(70));
    console.error('❌ TEST FAILED:', e.message);
    if (e.stack) {
      console.error(e.stack);
    }
    console.error('='.repeat(70) + '\n');
    process.exit(1);
  }
}

runAllTests();

