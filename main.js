/* =====================================================================
   KawalBRT — main.js
   Transport for Bandung
   ===================================================================== */

/* ── HTML include loader ─────────────────────────────────────────────
   Usage: <div data-include="header.html"></div>
   Fetches the file and replaces the placeholder element with its content.
   ===================================================================== */
async function loadIncludes() {
  const slots = document.querySelectorAll('[data-include]');
  await Promise.all([...slots].map(async slot => {
    const file = slot.getAttribute('data-include');
    try {
      const res = await fetch(file);
      if (!res.ok) throw new Error(`Could not load ${file}`);
      slot.outerHTML = await res.text();
    } catch (e) {
      console.warn(e);
    }
  }));
}

/* ── Navigation: hamburger + desktop dropdown ────────────────────────
   Called after includes are injected into the DOM.
   ===================================================================== */
function initNav() {

  /* ── Hamburger / mobile drawer ── */
  const hamburger = document.querySelector('.nav-hamburger');
  const mobileNav = document.querySelector('.nav-mobile');

  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      const isOpen = mobileNav.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', isOpen);
      hamburger.querySelector('.icon-menu').style.display  = isOpen ? 'none'  : 'block';
      hamburger.querySelector('.icon-close').style.display = isOpen ? 'block' : 'none';
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 900) {
        mobileNav.classList.remove('open');
        hamburger.setAttribute('aria-expanded', false);
        hamburger.querySelector('.icon-menu').style.display  = 'block';
        hamburger.querySelector('.icon-close').style.display = 'none';
        document.body.style.overflow = '';
      }
    });
  }

  /* ── Mobile sub-section toggles ── */
  document.querySelectorAll('.nav-mobile-section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const sub = btn.nextElementSibling;
      const isOpen = sub.classList.toggle('open');
      btn.classList.toggle('open', isOpen);
      btn.setAttribute('aria-expanded', isOpen);
    });
  });

  /* ── Desktop dropdown ── */
  document.querySelectorAll('.nav-dropdown').forEach(dropdown => {
    const toggle = dropdown.querySelector('.nav-dropdown-toggle');
    const menu = dropdown.querySelector('.nav-dropdown-menu');

    toggle.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = dropdown.classList.toggle('open');
      toggle.setAttribute('aria-expanded', isOpen);
    });

    menu?.addEventListener('click', e => {
      e.stopPropagation();
    });

    document.addEventListener('click', () => {
      dropdown.classList.remove('open');
      toggle.setAttribute('aria-expanded', false);
    });
  });
}

/* ── FAQ accordion ───────────────────────────────────────────────────
   Handles .faq-q click → toggles .faq-a visibility and ± chevron.
   Works on both index.html and any subpage that includes FAQ items.
   ===================================================================== */
function initFaq() {
  document.querySelectorAll('.faq-q').forEach(question => {
    question.addEventListener('click', () => {
      const answer  = question.nextElementSibling;
      const chevron = question.querySelector('.faq-chevron');
      const isOpen  = !answer.classList.contains('hidden');

      if (isOpen) {
        answer.classList.add('hidden');
        chevron.textContent = '+';
      } else {
        answer.classList.remove('hidden');
        chevron.textContent = '\u2212'; /* − */
      }
    });
  });
}

/* ── Bootstrap ───────────────────────────────────────────────────────
   Load includes → wire nav → wire FAQ.
   ===================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  await loadIncludes();
  initNav();
  initFaq();
});