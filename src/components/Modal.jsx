import { useEffect, useId, useRef } from 'react';
import { Close } from './Icons.jsx';

/** Accessible dialog built on <dialog>: focus is trapped, Esc and the backdrop close it. */
export function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return undefined;
    const previous = document.activeElement;
    if (!d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute('open', '');
      }
    }
    document.documentElement.classList.add('modal-open');
    const onCancel = (e) => {
      e.preventDefault();
      onCloseRef.current();
    };
    d.addEventListener('cancel', onCancel);
    return () => {
      d.removeEventListener('cancel', onCancel);
      document.documentElement.classList.remove('modal-open');
      if (d.open) d.close();
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' modal--wide' : ''}`}
      aria-labelledby={titleId}
      onMouseDown={(e) => {
        if (e.target === ref.current) onCloseRef.current();
      }}
    >
      <div className="modal__in">
        <div className="modal__head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Хаах" onClick={() => onCloseRef.current()}>
            <Close />
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </dialog>
  );
}
