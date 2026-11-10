"""Prepare Quick Look's HTML preview of the deck for a Chrome PDF export.
Quick Look stores some shapes as one-page PDFs; Chrome will not draw those inside HTML, so each one
is rasterised to PNG at 2x. The deck fonts are injected from teaching/fonts.
Usage: python render-quicklook.py <NAME.pptx.qlpreview>   (needs PyMuPDF)
"""
from pathlib import Path
import sys
import pymupdf

preview = Path(sys.argv[1]).resolve()
fonts = Path(__file__).resolve().parent / 'fonts'
html = (preview / 'Preview.html').read_text()
for asset in preview.glob('*.pdf'):
    with pymupdf.open(asset) as document:
        document[0].get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=True).save(str(asset) + '.png')
    html = html.replace(asset.name, asset.name + '.png')
html = html.replace('</head>', f'''<style>
@font-face{{font-family:'DM Sans';src:url('{(fonts / 'DMSans-Regular.ttf').as_uri()}')}}
@font-face{{font-family:'JetBrains Mono';src:url('{(fonts / 'JetBrainsMono-Regular.ttf').as_uri()}')}}
body{{margin:0!important;background:#07080F!important}}
div.slide{{margin:0!important;box-shadow:none!important;break-after:page}}
@media print{{div.slide{{page-break-after:always}}div.slide:last-of-type{{page-break-after:auto}}}}
</style></head>''')
(preview / 'Rendered.html').write_text(html)
print(preview / 'Rendered.html')
