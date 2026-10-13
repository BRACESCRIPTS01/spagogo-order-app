document.documentElement.classList.add('has-js');
var burger = document.querySelector('.siteNav-burger');
var links = document.getElementById('siteNavLinks');
if (burger && links) {
  burger.addEventListener('click', function () {
    var open = burger.getAttribute('aria-expanded') === 'true';
    burger.setAttribute('aria-expanded', String(!open));
    links.classList.toggle('is-open', !open);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') {
      burger.setAttribute('aria-expanded', 'false');
      links.classList.remove('is-open');
      burger.focus();
    }
  });
}
