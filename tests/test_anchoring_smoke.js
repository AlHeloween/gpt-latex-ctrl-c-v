/**
 * Smoke tests for formula/code anchoring functionality
 * Tests the anchoring and restoration logic
 */

function testFormulaAnchoring() {
  console.log("Testing formula anchoring patterns...");
  
  const patterns = [
    {
      name: "MathML element",
      input: '<p>Text <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math> end</p>',
      expectFormulas: 1,
    },
    {
      name: "LaTeX placeholder",
      input: '<p>Text <!--COF_TEX_0--> end</p>',
      expectFormulas: 1,
    },
    {
      name: "Data-math attribute",
      input: '<span data-math="x+1">x+1</span>',
      expectFormulas: 1,
    },
    {
      name: "OMML conditional comment",
      input: '<!--[if gte msEquation 12]><m:oMath>...</m:oMath><![endif]-->',
      expectFormulas: 1,
    },
    {
      name: "Multiple formulas",
      input: '<p><math>a</math> text <math>b</math> text <math>c</math></p>',
      expectFormulas: 3,
    },
  ];

  console.log("Formula anchoring test patterns:", patterns.length);
  return patterns;
}

function testCodeAnchoring() {
  console.log("Testing code anchoring patterns...");
  
  const patterns = [
    {
      name: "Pre block",
      input: '<p>Text <pre>code here</pre> end</p>',
      expectCodes: 1,
    },
    {
      name: "Inline code",
      input: '<p>Text <code>inline</code> end</p>',
      expectCodes: 1,
    },
    {
      name: "Code inside pre (should not be double-anchored)",
      input: '<pre><code>code</code></pre>',
      expectCodes: 1, // Only pre should be anchored
    },
    {
      name: "Multiple code blocks",
      input: '<p><pre>code1</pre> text <code>inline</code> text <pre>code2</pre></p>',
      expectCodes: 3,
    },
  ];

  console.log("Code anchoring test patterns:", patterns.length);
  return patterns;
}

function testAnchorRestoration() {
  console.log("Testing anchor restoration...");
  
  const testCases = [
    {
      name: "Restore single formula",
      anchored: "<p>Text [[COF_FORMULA_0]] end</p>",
      anchors: { formulas: ['<math>x+1</math>'], codes: [] },
      expectRestored: '<p>Text <math>x+1</math> end</p>',
    },
    {
      name: "Restore single code block",
      anchored: "<p>Text [[COF_CODE_0]] end</p>",
      anchors: { formulas: [], codes: ['<pre>code</pre>'] },
      expectRestored: '<p>Text <pre>code</pre> end</p>',
    },
    {
      name: "Restore multiple anchors",
      anchored: "<p>[[COF_FORMULA_0]] text [[COF_CODE_0]] text [[COF_FORMULA_1]]</p>",
      anchors: { formulas: ['<math>a</math>', '<math>b</math>'], codes: ['<pre>code</pre>'] },
      expectRestored: '<p><math>a</math> text <pre>code</pre> text <math>b</math></p>',
    },
  ];

  console.log("Anchor restoration test cases:", testCases.length);
  return testCases;
}

function testFormulaTranslation() {
  console.log("Testing formula translation...");
  
  const testCases = [
    {
      name: "Translate formulas when enabled",
      formulas: ['<math>x+1</math>'],
      service: "chatgpt",
      translateFormulas: true,
      expectTranslated: true,
    },
    {
      name: "Don't translate with Google/Microsoft",
      formulas: ['<math>x+1</math>'],
      service: "google",
      translateFormulas: true,
      expectTranslated: false, // Should not translate formulas with Google
    },
    {
      name: "Don't translate when disabled",
      formulas: ['<math>x+1</math>'],
      service: "chatgpt",
      translateFormulas: false,
      expectTranslated: false,
    },
  ];

  console.log("Formula translation test cases:", testCases.length);
  return testCases;
}

// Export test functions
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    testFormulaAnchoring,
    testCodeAnchoring,
    testAnchorRestoration,
    testFormulaTranslation,
  };
}

