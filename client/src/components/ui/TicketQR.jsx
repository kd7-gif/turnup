import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Draws a ticket code as a QR image in the browser. Nothing is sent anywhere. */
export default function TicketQR({ code, size = 168 }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(`TURNUP:${code}`, { width: size * 2, margin: 1, color: { dark: '#1a1307', light: '#ffffff' }, errorCorrectionLevel: 'M' })
      .then((url) => live && setSrc(url))
      .catch(() => {});
    return () => { live = false; };
  }, [code, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt={`QR code for ticket ${code}`} />
    : <span className="qr qr-loading" style={{ width: size, height: size }} />;
}
