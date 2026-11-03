import { PARTNER_KINDS } from '../data/static.js';
import { track } from '../lib/api.js';

const SOCIALS = [
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
];

export function Footer({ settings, messenger, actions }) {
  const socials = SOCIALS.filter(([k]) => settings[k]);
  const chat = messenger && messenger.enabled ? messenger.link : '';
  const contact = [
    settings.phone && { label: 'Утас', value: settings.phone, href: `tel:${settings.phone.replace(/\s/g, '')}` },
    settings.email && { label: 'И-мэйл', value: settings.email, href: `mailto:${settings.email}` },
    settings.address && { label: 'Хаяг', value: settings.address },
  ].filter(Boolean);
  return (
    <footer className="foot" id="partner">
      <div className="wrap">
        <p className="foot__mark" aria-hidden="true">DOMCH</p>
        <div className="foot__grid">
          <div>
            <h2>ДОМЧ</h2>
            <p>Жамц давсны уусмал, спирт агуулаагүй ам зайлагч. Үйлдвэрлэгч: Жем Интернэшнл ХХК.</p>
            {(socials.length > 0 || chat) && (
              <ul className="foot__social">
                {socials.map(([k, label]) => (
                  <li key={k}><a href={settings[k]} target="_blank" rel="noopener noreferrer">{label}</a></li>
                ))}
                {chat && (
                  <li><a href={chat} target="_blank" rel="noopener noreferrer" onClick={() => track('messenger_click', { from: 'footer' })}>Messenger</a></li>
                )}
              </ul>
            )}
          </div>
          <div>
            <h2>БҮТЭЭГДЭХҮҮН</h2>
            <ul>
              <li><button type="button" onClick={() => actions.goTo('sizes')}>Домч ам зайлагч</button></li>
              <li><button type="button" onClick={() => actions.goTo('ingredients')}>Орц, найрлага</button></li>
              <li><button type="button" onClick={() => actions.goTo('usage')}>Хэрэглэх заавар</button></li>
              <li><button type="button" onClick={() => actions.goTo('faq')}>Түгээмэл асуулт</button></li>
            </ul>
          </div>
          <div>
            <h2>ХАМТРАН АЖИЛЛАХ</h2>
            <ul>
              {PARTNER_KINDS.map((k) => (
                <li key={k.id}><button type="button" onClick={() => actions.open('partner', { kind: k.id })}>{k.label}</button></li>
              ))}
            </ul>
          </div>
          <div>
            <h2>ХОЛБОО БАРИХ</h2>
            {contact.length ? (
              <ul>
                {contact.map((c) => (
                  <li key={c.label}>
                    <span className="foot__k">{c.label}: </span>
                    {c.href ? <a href={c.href}>{c.value}</a> : <span className="selectable">{c.value}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <ul>
                <li><button type="button" onClick={() => actions.open('partner', { kind: 'pharmacy' })}>Хүсэлт илгээх</button></li>
                <li><button type="button" onClick={() => actions.open('question')}>Эмчээс асуух</button></li>
              </ul>
            )}
          </div>
        </div>
        <div className="foot__bottom">
          <span>© {new Date().getFullYear()} Жем Интернэшнл ХХК</span>
          <div>
            <button type="button" onClick={() => actions.open('privacy')}>Нууцлалын бодлого</button>
          </div>
        </div>
      </div>
    </footer>
  );
}
