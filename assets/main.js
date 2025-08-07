// Mobile menu toggle
const toggle = document.getElementById('menu-toggle');
const links = document.getElementById('nav-links');
if (toggle) {
  toggle.addEventListener('click', () => links.classList.toggle('open'));
}

// Smooth-scroll active link highlight (progressive enhancement) [20][23]
const sections = document.querySelectorAll('main section[id]');
const navAnchors = document.querySelectorAll('#nav-links a');

function setActive() {
  let cur = '';
  sections.forEach(sec => {
    const top = window.scrollY + 120;
    if (top >= sec.offsetTop && top < sec.offsetTop + sec.offsetHeight) {
      cur = '#' + sec.id;
    }
  });
  navAnchors.forEach(a => a.classList.toggle('active', a.getAttribute('href') === cur));
}
document.addEventListener('scroll', setActive);
setActive();

// Current year in footer
const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();
