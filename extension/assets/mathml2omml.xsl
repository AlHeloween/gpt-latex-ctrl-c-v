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

  <xsl:template match="ml:mrow|ml:mstyle|ml:mphantom">
    <xsl:apply-templates/>
  </xsl:template>

  <xsl:template match="ml:mi|ml:mn|ml:mo|ml:ms">
    <m:r><m:t xml:space="preserve"><xsl:value-of select="."/></m:t></m:r>
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

  <xsl:template match="ml:mfrac">
    <m:f>
      <m:num><xsl:apply-templates select="ml:*[1]"/></m:num>
      <m:den><xsl:apply-templates select="ml:*[2]"/></m:den>
    </m:f>
  </xsl:template>

  <xsl:template match="ml:msqrt">
    <m:rad>
      <m:deg/>
      <m:e><xsl:apply-templates/></m:e>
    </m:rad>
  </xsl:template>

  <xsl:template match="ml:mroot">
    <m:rad>
      <m:deg><xsl:apply-templates select="ml:*[2]"/></m:deg>
      <m:e><xsl:apply-templates select="ml:*[1]"/></m:e>
    </m:rad>
  </xsl:template>

  <xsl:template match="ml:mtable">
    <m:m>
      <xsl:for-each select="ml:mtr">
        <m:mr><xsl:apply-templates select="ml:mtd"/></m:mr>
      </xsl:for-each>
    </m:m>
  </xsl:template>

  <xsl:template match="ml:mtd">
    <m:e><xsl:apply-templates/></m:e>
  </xsl:template>

  <xsl:template match="text()"/>
</xsl:stylesheet>
