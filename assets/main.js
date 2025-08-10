// // Mobile menu toggle
// const toggle = document.getElementById('menu-toggle');
// const links = document.getElementById('nav-links');
// if (toggle) {
//   toggle.addEventListener('click', () => links.classList.toggle('open'));
// }

// // Smooth-scroll active link highlight (progressive enhancement) [20][23]
// const sections = document.querySelectorAll('main section[id]');
// const navAnchors = document.querySelectorAll('#nav-links a');

// function setActive() {
//   let cur = '';
//   sections.forEach(sec => {
//     const top = window.scrollY + 120;
//     if (top >= sec.offsetTop && top < sec.offsetTop + sec.offsetHeight) {
//       cur = '#' + sec.id;
//     }
//   });
//   navAnchors.forEach(a => a.classList.toggle('active', a.getAttribute('href') === cur));
// }
// document.addEventListener('scroll', setActive);
// setActive();

// // Current year in footer
// const year = document.getElementById('year');
// if (year) year.textContent = new Date().getFullYear();


(function () {
  'use strict';

  // Run a callback after DOM is ready
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  // Set footer year if the #year element exists
  function initFooterYear() {
    var y = document.getElementById('year');
    if (y) {
      y.textContent = new Date().getFullYear();
    }
  }

  // Initialize clickable dropdown behavior for project bars
  function initProjectDropdowns() {
    // Bars are marked with data-project-bar in the HTML
    var bars = document.querySelectorAll('[data-project-bar]');
    if (!bars || !bars.length) return;

    bars.forEach(function (bar) {
      // Toggle open/closed on click anywhere in the bar except on links
      bar.addEventListener('click', function (e) {
        if (e.target && e.target.closest('a')) return; // don't toggle when a link is clicked
        bar.classList.toggle('open');
      });

      // Keyboard accessibility: toggle on Enter/Space when focused
      bar.addEventListener('keydown', function (e) {
        var key = e.key || e.code;
        if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
          e.preventDefault();
          bar.classList.toggle('open');
        }
      });
    });
  }

  // Initialize all features
  ready(function () {
    initFooterYear();
    initProjectDropdowns();
  });
})();
