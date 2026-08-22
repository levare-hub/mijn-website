(function(d, t) {
  var v = d.createElement(t);
  var s = d.getElementsByTagName(t)[0];

  v.onload = function() {
    window.voiceflow.chat.load({
      verify: {
        projectID: '6a896dfb5fb7f09a24bcabad'
      },
      url: 'https://general-runtime.voiceflow.com',
      voice: {
        url: 'https://runtime-api.voiceflow.com'
      }
    });
  };

  v.src = 'https://cdn.voiceflow.com/widget-next/bundle.mjs';
  v.type = 'text/javascript';

  s.parentNode.insertBefore(v, s);
})(document, 'script');
