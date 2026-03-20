/*
  Legacy file retained intentionally.

  The active app now uses a modular, object-oriented structure:

  - src/main.js                -> bootstrap
  - src/steve-chat-app.js      -> SteveChatApp class (app controller)
  - src/dom.js                 -> DOM reference mapping
  - src/services/gesture-service.js
  - src/services/identicon-service.js

  index.html now loads: <script type="module" src="./src/main.js"></script>
*/
