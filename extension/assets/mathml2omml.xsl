<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"
  xmlns:ml="http://www.w3.org/1998/Math/MathML">
  <xsl:output method="xml" indent="no"/>

  <xsl:template match="/">
    <m:oMath>
      <xsl:apply-templates select="ml:math/*"/>
    </m:oMath>
  </xsl:template>

  <!-- Prefer the semantic content (ignore annotations). -->
  <xsl:template match="ml:semantics">
    <xsl:apply-templates select="ml:*[1]"/>
  </xsl:template>
  <xsl:template match="ml:annotation|ml:annotation-xml"/>

  <!-- Sequential emitter for mrow-like containers so we can combine operator+limits with the following expression. -->
  <xsl:template match="ml:mrow|ml:mstyle|ml:mpadded|ml:mphantom">
    <xsl:call-template name="emit-seq">
      <xsl:with-param name="nodes" select="node()"/>
    </xsl:call-template>
  </xsl:template>

  <xsl:template name="emit-seq">
    <xsl:param name="nodes"/>
    <xsl:if test="$nodes">
      <xsl:variable name="first" select="$nodes[1]"/>
      <xsl:variable name="next" select="$nodes[2]"/>

      <!-- Detect n-ary ops represented as <munderover>/<msubsup> on a mo (e.g., ∑_i^n a_i). -->
      <xsl:choose>
        <xsl:when test="name($first)='ml:munderover' and $next and (normalize-space(string($first/*[1]))='∑' or normalize-space(string($first/*[1]))='∏' or normalize-space(string($first/*[1]))='∫')">
          <m:nary>
            <m:naryPr>
              <m:chr m:val="{normalize-space(string($first/*[1]))}"/>
              <m:limLoc m:val="undOvr"/>
            </m:naryPr>
            <m:sub><xsl:apply-templates select="$first/*[2]"/></m:sub>
            <m:sup><xsl:apply-templates select="$first/*[3]"/></m:sup>
            <m:e><xsl:apply-templates select="$next"/></m:e>
          </m:nary>
          <xsl:call-template name="emit-seq">
            <xsl:with-param name="nodes" select="$nodes[position() &gt; 2]"/>
          </xsl:call-template>
        </xsl:when>

        <xsl:when test="name($first)='ml:msubsup' and $next and (normalize-space(string($first/*[1]))='∑' or normalize-space(string($first/*[1]))='∏' or normalize-space(string($first/*[1]))='∫')">
          <m:nary>
            <m:naryPr>
              <m:chr m:val="{normalize-space(string($first/*[1]))}"/>
              <m:limLoc m:val="undOvr"/>
            </m:naryPr>
            <m:sub><xsl:apply-templates select="$first/*[2]"/></m:sub>
            <m:sup><xsl:apply-templates select="$first/*[3]"/></m:sup>
            <m:e><xsl:apply-templates select="$next"/></m:e>
          </m:nary>
          <xsl:call-template name="emit-seq">
            <xsl:with-param name="nodes" select="$nodes[position() &gt; 2]"/>
          </xsl:call-template>
        </xsl:when>

        <xsl:otherwise>
          <xsl:apply-templates select="$first"/>
          <xsl:call-template name="emit-seq">
            <xsl:with-param name="nodes" select="$nodes[position() &gt; 1]"/>
          </xsl:call-template>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:if>
  </xsl:template>

  <xsl:template match="ml:mi|ml:mn|ml:mo|ml:ms">
    <m:r>
      <xsl:choose>
        <!-- Bold variants -->
        <xsl:when test="contains(@mathvariant, 'bold')">
          <m:rPr>
            <!-- Bold (and keep italic unless explicitly normal). -->
            <m:sty m:val="b"/>
            <xsl:if test="@mathvariant='bold'">
              <m:nor/>
            </xsl:if>
          </m:rPr>
        </xsl:when>
        <!-- Upright text (common for function/operator names and \mathrm/\text outputs) -->
        <xsl:when test="@mathvariant='normal'">
          <m:rPr><m:nor/></m:rPr>
        </xsl:when>
      </xsl:choose>
      <m:t xml:space="preserve"><xsl:value-of select="."/></m:t>
    </m:r>
  </xsl:template>
  
  <!-- \text{...} in TeX typically becomes <mtext>...</mtext>. In Word OMML,
       mark these runs as "normal" (non-italic) so identifiers like Logit/Sc render correctly. -->
  <xsl:template match="ml:mtext">
    <m:r>
      <m:rPr><m:nor/></m:rPr>
      <m:t xml:space="preserve"><xsl:value-of select="."/></m:t>
    </m:r>
  </xsl:template>

  <xsl:template match="ml:mspace">
    <m:r><m:t xml:space="preserve"> </m:t></m:r>
  </xsl:template>

  <xsl:template match="ml:msup">
    <m:sSup>
      <m:e><xsl:apply-templates select="ml:*[1]"/></m:e>
      <m:sup><xsl:apply-templates select="ml:*[2]"/></m:sup>
    </m:sSup>
  </xsl:template>

  <xsl:template match="ml:msub">
    <m:sSub>
      <m:e><xsl:apply-templates select="ml:*[1]"/></m:e>
      <m:sub><xsl:apply-templates select="ml:*[2]"/></m:sub>
    </m:sSub>
  </xsl:template>

  <xsl:template match="ml:msubsup">
    <m:sSubSup>
      <m:e><xsl:apply-templates select="ml:*[1]"/></m:e>
      <m:sub><xsl:apply-templates select="ml:*[2]"/></m:sub>
      <m:sup><xsl:apply-templates select="ml:*[3]"/></m:sup>
    </m:sSubSup>
  </xsl:template>

  <!-- MathML multiscripts are complex; support the common base+sub+sup case deterministically. -->
  <xsl:template match="ml:mmultiscripts">
    <xsl:choose>
      <xsl:when test="count(ml:*) &gt;= 3">
        <m:sSubSup>
          <m:e><xsl:apply-templates select="ml:*[1]"/></m:e>
          <m:sub><xsl:apply-templates select="ml:*[2]"/></m:sub>
          <m:sup><xsl:apply-templates select="ml:*[3]"/></m:sup>
        </m:sSubSup>
      </xsl:when>
      <xsl:otherwise>
        <xsl:apply-templates/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template match="ml:mfrac">
    <m:f>
      <m:num><xsl:apply-templates select="ml:*[1]"/></m:num>
      <m:den><xsl:apply-templates select="ml:*[2]"/></m:den>
    </m:f>
  </xsl:template>

  <xsl:template match="ml:msqrt">
    <m:rad>
      <!-- Square root: hide the degree to avoid Word showing an empty "n" placeholder. -->
      <m:radPr><m:degHide m:val="1"/></m:radPr>
      <m:deg/>
      <m:e><xsl:apply-templates/></m:e>
    </m:rad>
  </xsl:template>

  <xsl:template match="ml:mroot">
    <m:rad>
      <m:radPr>
        <!-- Hide degree when it is missing/empty or equals 2 (treat as sqrt). -->
        <xsl:if test="not(ml:*[2]) or normalize-space(string(ml:*[2]))='' or (name(ml:*[2])='ml:mn' and normalize-space(string(ml:*[2]))='2')">
          <m:degHide m:val="1"/>
        </xsl:if>
      </m:radPr>
      <m:deg><xsl:apply-templates select="ml:*[2]"/></m:deg>
      <m:e><xsl:apply-templates select="ml:*[1]"/></m:e>
    </m:rad>
  </xsl:template>

  <!-- Fenced expressions: parentheses/brackets with optional separators. -->
  <xsl:template match="ml:mfenced">
    <m:d>
      <m:dPr>
        <m:begChr>
          <xsl:attribute name="m:val">
            <xsl:choose>
              <xsl:when test="string(@open) != ''"><xsl:value-of select="@open"/></xsl:when>
              <xsl:otherwise>(</xsl:otherwise>
            </xsl:choose>
          </xsl:attribute>
        </m:begChr>
        <m:endChr>
          <xsl:attribute name="m:val">
            <xsl:choose>
              <xsl:when test="string(@close) != ''"><xsl:value-of select="@close"/></xsl:when>
              <xsl:otherwise>)</xsl:otherwise>
            </xsl:choose>
          </xsl:attribute>
        </m:endChr>
        <xsl:if test="@separators">
          <m:sepChr m:val="{substring(@separators, 1, 1)}"/>
        </xsl:if>
      </m:dPr>
      <m:e>
        <xsl:call-template name="emit-seq">
          <xsl:with-param name="nodes" select="node()"/>
        </xsl:call-template>
      </m:e>
    </m:d>
  </xsl:template>

  <!-- Over/under constructs: handle common limits and accents. -->
  <xsl:template match="ml:mover">
    <xsl:variable name="accent" select="normalize-space(string(ml:*[2]))"/>
    <xsl:choose>
      <xsl:when test="$accent='¯' or $accent='^' or $accent='~' or $accent='˙' or $accent='¨' or $accent='→' or $accent='←' or $accent='↔'">
        <m:acc>
          <m:accPr><m:chr m:val="{$accent}"/></m:accPr>
          <m:e><xsl:apply-templates select="ml:*[1]"/></m:e>
        </m:acc>
      </xsl:when>
      <xsl:otherwise>
        <m:limUpp>
          <m:e><xsl:apply-templates select="ml:*[1]"/></m:e>
          <m:lim><xsl:apply-templates select="ml:*[2]"/></m:lim>
        </m:limUpp>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template match="ml:munder">
    <m:limLow>
      <m:e><xsl:apply-templates select="ml:*[1]"/></m:e>
      <m:lim><xsl:apply-templates select="ml:*[2]"/></m:lim>
    </m:limLow>
  </xsl:template>

  <xsl:template match="ml:munderover">
    <m:limLow>
      <m:e>
        <m:limUpp>
          <m:e><xsl:apply-templates select="ml:*[1]"/></m:e>
          <m:lim><xsl:apply-templates select="ml:*[3]"/></m:lim>
        </m:limUpp>
      </m:e>
      <m:lim><xsl:apply-templates select="ml:*[2]"/></m:lim>
    </m:limLow>
  </xsl:template>

  <xsl:template match="ml:mtable">
    <m:m>
      <xsl:for-each select="ml:mtr">
        <m:mr><xsl:apply-templates select="ml:mtd"/></m:mr>
      </xsl:for-each>
    </m:m>
  </xsl:template>

  <!-- Cases/piecewise sometimes comes as <mrow><mo>{</mo><mtable>...</mtable></mrow>; this is still a matrix. -->
  <xsl:template match="ml:mtd">
    <m:e><xsl:apply-templates/></m:e>
  </xsl:template>

  <!-- Boxes/strikethroughs/etc: support the common "box" notation. -->
  <xsl:template match="ml:menclose">
    <xsl:choose>
      <xsl:when test="contains(@notation, 'box') or contains(@notation, 'roundedbox')">
        <m:borderBox>
          <m:e><xsl:apply-templates/></m:e>
        </m:borderBox>
      </xsl:when>
      <xsl:otherwise>
        <xsl:apply-templates/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template match="text()"/>
</xsl:stylesheet>
