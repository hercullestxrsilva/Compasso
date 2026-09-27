"""Synthetic JPEG2000 PDF fixture; no copyrighted score or user data."""
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageDraw

image = Image.new('RGB', (900, 1200), 'white')
draw = ImageDraw.Draw(image)
draw.text((60, 55), 'COMPASSO - TESTE DE PARTITURA DIGITALIZADA (JPEG2000)', fill='black')
for top in range(150, 1050, 180):
    for line in range(5):
        draw.line((65, top + line * 18, 835, top + line * 18), fill='black', width=2)
    for x in range(140, 800, 135):
        draw.ellipse((x, top + 24, x + 24, top + 42), fill='black')
        draw.line((x + 23, top + 33, x + 23, top - 24), fill='black', width=3)
encoded = BytesIO()
image.save(encoded, format='JPEG2000')
data = encoded.getvalue()
content = b'q 450 0 0 600 25 25 cm /Im1 Do Q'
objects = [
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 650] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
    b'<< /Type /XObject /Subtype /Image /Width 900 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode /Length ' + str(len(data)).encode() + b' >>\nstream\n' + data + b'\nendstream',
    b'<< /Length ' + str(len(content)).encode() + b' >>\nstream\n' + content + b'\nendstream',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 650] /Rotate 90 /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
]
pdf = bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')
offsets = [0]
for number, obj in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf.extend(f'{number} 0 obj\n'.encode() + obj + b'\nendobj\n')
xref = len(pdf)
pdf.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
for offset in offsets[1:]:
    pdf.extend(f'{offset:010} 00000 n \n'.encode())
pdf.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
target = Path(__file__).resolve().parent.parent / 'tests/fixtures/partitura-jpeg2000.pdf'
target.write_bytes(pdf)
print(f'Created synthetic two-page PDF: {target.name}, {len(pdf)} bytes')
