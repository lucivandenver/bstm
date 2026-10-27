import { format } from 'node:util';
// Session-backed messages without the deprecated util.isArray used by connect-flash.
export default function flash() {
  return (req, res, next) => {
    req.flash = function (type, message, ...args) {
      const bag = req.session.flash ||= {};
      if (arguments.length === 0) { req.session.flash = {}; return bag; }
      if (typeof type !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(type)) throw new Error('Invalid flash message type.');
      if (arguments.length === 1) { const messages = Object.hasOwn(bag, type) ? bag[type] : []; delete bag[type]; return messages; }
      const messages = args.length ? [format(message, ...args)] : Array.isArray(message) ? message.map(String) : [String(message)];
      if (!Object.hasOwn(bag, type)) Object.defineProperty(bag, type, { value: [], writable: true, enumerable: true, configurable: true });
      bag[type].push(...messages);
      return bag[type].length;
    };
    next();
  };
}
