'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

/**
 * Sign by typing your full name (always available, works with a keyboard) or by drawing. Posts three hidden/visible inputs:
 * signatureMethod, typedName and signatureImage (base64 PNG, no data-URL prefix).
 */
export function SignaturePad({ statement, idPrefix = 'sig' }: { statement: string; idPrefix?: string }) {
  const [method, setMethod] = useState<'typed' | 'drawn'>('typed');
  const [image, setImage] = useState('');
  const [typedName, setTypedName] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c || method !== 'drawn') return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
  }, [method]);

  function point(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    drawing.current = true;
    canvas.current!.setPointerCapture(e.pointerId);
    const [x, y] = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.01, y + 0.01);
    ctx.stroke();
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const [x, y] = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    const url = canvas.current!.toDataURL('image/png');
    setImage(url.replace(/^data:image\/png;base64,/, ''));
  }
  function clear() {
    const c = canvas.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setImage('');
  }

  return (
    <fieldset className="space-y-3 rounded-md border border-line p-4">
      <legend className="px-1 text-sm font-semibold">Signature</legend>
      <p className="text-sm">{statement}</p>
      <div className="flex gap-4">
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="signatureMethodChoice" checked={method === 'typed'} onChange={() => setMethod('typed')} /> Type my name
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="signatureMethodChoice" checked={method === 'drawn'} onChange={() => setMethod('drawn')} /> Draw
        </label>
      </div>
      <input type="hidden" name="signatureMethod" value={method} />
      {method === 'typed' ? (
        <Field id={`${idPrefix}-name`} label="Type your full name to sign" hint="Exactly as it appears on your member record.">
          <Input id={`${idPrefix}-name`} name="typedName" value={typedName} onChange={(e) => setTypedName(e.target.value)} autoComplete="name" />
        </Field>
      ) : (
        <div className="space-y-2">
          <canvas
            ref={canvas} width={600} height={200} role="img" aria-label="Signature drawing area. Use the Type my name option to sign with the keyboard."
            className="h-auto w-full max-w-full touch-none rounded-md border border-line bg-white"
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          />
          <input type="hidden" name="signatureImage" value={image} />
          <Button type="button" variant="secondary" onClick={clear}>Clear signature</Button>
        </div>
      )}
    </fieldset>
  );
}
