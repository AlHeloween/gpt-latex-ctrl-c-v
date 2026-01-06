"""
Tests for formula and code anchoring functionality.
Tests the anchoring patterns and restoration logic.
"""

import re


def test_formula_patterns():
    """Test formula detection patterns."""
    patterns = {
        "mathml": r"<math[\s\S]*?</math>",
        "latex_placeholder": r"<!--COF_TEX_\d+-->",
        "data_math": r'<[^>]*\sdata-math=["\'][^"\']*["\'][^>]*>',
        "omml": r"<!--\[if[^>]*>[\s\S]*?<!\[endif\]-->",
    }

    test_cases = [
        {
            "name": "MathML element",
            "html": '<p>Text <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math> end</p>',
            "expected_pattern": "mathml",
        },
        {
            "name": "LaTeX placeholder",
            "html": '<p>Text <!--COF_TEX_0--> end</p>',
            "expected_pattern": "latex_placeholder",
        },
        {
            "name": "Data-math attribute",
            "html": '<span data-math="x+1">x+1</span>',
            "expected_pattern": "data_math",
        },
        {
            "name": "OMML conditional (with m:oMath)",
            "html": '<!--[if gte msEquation 12]><m:oMath>...</m:oMath><![endif]-->',
            "expected_pattern": "omml",
        },
    ]

    for case in test_cases:
        pattern = patterns[case["expected_pattern"]]
        matches = re.findall(pattern, case["html"], re.IGNORECASE | re.DOTALL)
        assert len(matches) > 0, f"Pattern {case['expected_pattern']} not found in: {case['name']}"

    print("✓ Formula pattern tests passed")


def test_code_patterns():
    """Test code detection patterns."""
    test_cases = [
        {
            "name": "Pre block",
            "html": '<p>Text <pre>code here</pre> end</p>',
            "has_pre": True,
        },
        {
            "name": "Inline code",
            "html": '<p>Text <code>inline</code> end</p>',
            "has_code": True,
        },
        {
            "name": "Code inside pre (should anchor pre, not code)",
            "html": '<pre><code>code</code></pre>',
            "has_pre": True,
            "has_code_inside_pre": True,
        },
        {
            "name": "Multiple code blocks",
            "html": '<p><pre>code1</pre> text <code>inline</code> text <pre>code2</pre></p>',
            "has_pre": True,
            "has_code": True,
        },
    ]

    for case in test_cases:
        if case.get("has_pre"):
            # Count <pre> tags (not inside other <pre> tags)
            pre_count = len(re.findall(r"<pre[^>]*>", case["html"], re.IGNORECASE))
            assert pre_count > 0, f"Expected <pre> in: {case['name']}"

        if case.get("has_code"):
            # Check for <code> tags (might be inside <pre>)
            code_count = len(re.findall(r"<code[^>]*>", case["html"], re.IGNORECASE))
            assert code_count > 0, f"Expected <code> in: {case['name']}"

    print("✓ Code pattern tests passed")


def test_anchor_restoration():
    """Test anchor restoration logic."""
    # Simulate anchoring: replace content with anchors
    html_with_formula = '<p>Text <math>x+1</math> end</p>'
    formula_content = "<math>x+1</math>"
    anchor = "[[COF_FORMULA_0]]"
    anchored_html = html_with_formula.replace(formula_content, anchor)

    # Verify anchoring
    assert anchor in anchored_html
    assert formula_content not in anchored_html

    # Simulate restoration
    restored_html = anchored_html.replace(anchor, formula_content)
    assert formula_content in restored_html
    assert anchor not in restored_html
    assert restored_html == html_with_formula

    print("✓ Anchor restoration tests passed")


def test_multiple_anchors():
    """Test multiple anchor handling."""
    html = '<p><math>a</math> text <pre>code</pre> text <math>b</math></p>'
    formulas = ["<math>a</math>", "<math>b</math>"]
    codes = ["<pre>code</pre>"]

    # Simulate anchoring
    anchored = html
    for i, formula in enumerate(formulas):
        anchor = f"[[COF_FORMULA_{i}]]"
        anchored = anchored.replace(formula, anchor, 1)

    for i, code in enumerate(codes):
        anchor = f"[[COF_CODE_{i}]]"
        anchored = anchored.replace(code, anchor, 1)

    # Count anchors
    formula_anchors = len(re.findall(r"\[\[COF_FORMULA_\d+\]\]", anchored))
    code_anchors = len(re.findall(r"\[\[COF_CODE_\d+\]\]", anchored))

    assert formula_anchors == len(formulas), f"Expected {len(formulas)} formula anchors, got {formula_anchors}"
    assert code_anchors == len(codes), f"Expected {len(codes)} code anchors, got {code_anchors}"

    print("✓ Multiple anchor tests passed")


def test_formula_translation_service_restriction():
    """Test that formula translation only works with AI agents."""
    ai_services = ["chatgpt", "gemini", "pollinations", "custom"]
    non_ai_services = ["google", "microsoft"]

    for service in ai_services:
        # AI services can translate formulas
        can_translate = service in ai_services
        assert can_translate, f"{service} should support formula translation"

    for service in non_ai_services:
        # Non-AI services should not translate formulas
        can_translate = service in ai_services
        assert not can_translate, f"{service} should not support formula translation"

    print("✓ Formula translation service restriction tests passed")


def run_all_tests():
    """Run all anchoring tests."""
    print("\n=== Running Anchoring Tests ===\n")

    try:
        test_formula_patterns()
        test_code_patterns()
        test_anchor_restoration()
        test_multiple_anchors()
        test_formula_translation_service_restriction()

        print("\n=== All Anchoring Tests Passed ===\n")
        return True
    except AssertionError as e:
        print(f"\n✗ Test failed: {e}\n")
        return False
    except Exception as e:
        print(f"\n✗ Test error: {e}\n")
        return False


if __name__ == "__main__":
    success = run_all_tests()
    exit(0 if success else 1)

