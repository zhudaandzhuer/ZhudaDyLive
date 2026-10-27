import React, { useEffect, useState } from 'react';
import type { MobilePreviewStatus } from '@zhuda/contracts';

export function MobilePreviewDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<MobilePreviewStatus | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const address =
    status?.addresses.find((entry) => entry.address === selected) ?? status?.addresses[0];
  async function act(action: 'start' | 'stop') {
    setBusy(true);
    setError('');
    try {
      setStatus(await window.studio.mobilePreview(action));
    } catch (error) {
      setError(
        (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''),
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void act('start');
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="launch-modal mobile-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-preview-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          aria-label="关闭手机预览面板"
          onClick={onClose}
        >
          ×
        </button>
        <span className="eyebrow">同一 Wi-Fi · 实时预览</span>
        <h2 id="mobile-preview-title">手机预览</h2>
        <p>手机与电脑连接同一网络，扫码查看当前场景。</p>
        {busy && !status && <div className="mobile-qr-placeholder">正在生成二维码…</div>}
        {status?.active && address && (
          <>
            {status.addresses.length > 1 && (
              <label>
                电脑网络地址
                <select
                  aria-label="电脑网络地址"
                  value={address.address}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    setCopied(false);
                  }}
                >
                  {status.addresses.map((entry) => (
                    <option key={entry.address} value={entry.address}>
                      {entry.address} · {entry.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <img
              className="mobile-qr"
              src={address.qr}
              alt="手机预览二维码"
              width="256"
              height="256"
            />
            <div className="mobile-preview-link">
              <input
                aria-label="手机预览地址"
                value={address.url}
                readOnly
                onFocus={(event) => event.target.select()}
              />
              <button
                className="button secondary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(address.url)
                    .then(() => setCopied(true))
                    .catch(() => setError('复制失败，请手动复制上方地址'));
                }}
              >
                {copied ? '已复制' : '复制链接'}
              </button>
            </div>
            <p className="mobile-preview-help">
              扫码后在浏览器打开。无法连接时，检查是否同一 Wi-Fi，并允许电脑防火墙的本地网络访问。
            </p>
            <div className="mobile-preview-footer">
              <small>关闭面板后继续分享</small>
              <button className="button secondary" disabled={busy} onClick={() => void act('stop')}>
                停止分享
              </button>
            </div>
          </>
        )}
        {status && !status.active && (
          <div className="mobile-preview-stopped">
            <p>分享已停止，原二维码已失效。</p>
            <button className="button" disabled={busy} onClick={() => void act('start')}>
              重新开启
            </button>
          </div>
        )}
        {status?.active && !address && <p>当前网络已断开，请连接网络后重新开启分享。</p>}
        {error && (
          <p className="mobile-preview-error" role="alert">
            {error}
          </p>
        )}
        {error && !status && (
          <button className="button" disabled={busy} onClick={() => void act('start')}>
            重试
          </button>
        )}
      </section>
    </div>
  );
}
