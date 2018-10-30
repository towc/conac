const { promisify } = require('util');
const path = require('path');

const express = require('express');
const bodyParser = require('body-parser');

const noop = () => {};
const ID = x => x;
const { affirm } = require('./affirm.js');

class Conac {
  constructor(opts = {}) {
    const {
      plugin = [],
      config = {},
      errors = {},
      events = {},
      routes = {},

      startImmediately = true,
    } = opts;

    this.app = express();

    this.app.use(bodyParser.json());

    this.setConfig(config);
    this.setErrors(errors);
    this.setEvents(events);
    this.setRoutes(routes);

    this.callEvent('routesDone');

    this.setPlugin(plugin);
    this.callEvent('pluginDone');


    if (startImmediately) {
      this.listen();
    }
  }

  listen(port = this.config.port, cb = this.events.listen) {
    return promisify(this.app.listen.bind(this.app))(port)
      .then((...args) => this.callEvent('listen', ...args));
  }

  setPlugin(plugins) {
    this.plugins = arraify(plugins);

    this.applyPlugin(plugins);
  }

  applyPlugin(maybePlugins = []) {
    const plugins = arraify(maybePlugins);

    plugins.forEach((maybePlugin) => {
      let plugin;
      if (maybePlugin instanceof String) {
        try {
          plugin = require(maybePlugin);
        } catch (e) {
          console.error(`conac plugins: something is wrong with ${maybePlugin}. Make sure you "npm i"ed it first, or that it exports without errors`);
          throw e;
        }
      } else {
        plugin = maybePlugin;
      }

      if (plugin instanceof Function) {
        plugin(this);
        return;
      }

      const {
        middleware = [],
        onapp = noop,
        beforeAcc = noop,
        before = noop,
        after = noop,
        afterAcc = noop,
        requires = [],
        routes = {},
      } = plugin;

      this.setPlugin(requires);
      this.applyRoutes(routes);

      middleware.forEach((fn) => {
        this.app.use(fn());
      });

      arraify(onapp).forEach((fn) => {
        fn(this.app);
      });

      // NOTE: these all go before previous events, not after
      this.events.beforeAcc.unshift(...beforeAcc);
      this.events.before.unshift(...before);
      this.events.after.unshift(...after);
      this.events.afterAcc.unshift(...afterAcc);
    });
  }

  setConfig(config = {}) {
    const {
      port = 8080,
      ...rest
    } = config;

    this.config = {
      port,
      ...rest,
    };
  }

  setErrors(errors = {}) {
    this.errors = errors;
  }

  setEvents(events = {}) {
    const {
      beforeAcc = noop,
      before = noop,
      after = noop,
      afterAcc = noop,

      routesDone = noop,
      pluginDone = noop,

      listen = () => console.log(`listening on port ${this.config.port}`),
      error = ID,
      ...rest
    } = events;

    this.events = {
      beforeAcc: arraify(beforeAcc),
      before: arraify(before),
      after: arraify(after),
      afterAcc: arraify(afterAcc),
      routesDone: arraify(routesDone),
      pluginDone: arraify(pluginDone),
      listen: arraify(listen),
      error: arraify(error),
      ...rest,
    };
  }

  async callEvent(type, ...args) {
    for (const fn of this.events[type]) {
      await fn.bind(this)(...args);
    }
  }

  setRoutes(routes = {}) {
    this.routes = routes;

    this.applyRoutes(routes);
  }

  applyRoutes(routesObj = {}, context = {}) {
    const {
      baseMethod = 'get',
      basePath = '/',
      baseBefore = [],
      baseAfter = [],
    } = context;

    const {
      before: routeBefore = noop,
      after: routeAfter = noop,
      plugin = [],
      routes = {},
    } = getHandler(routesObj);

    // TODO route-level plugins
    /*
    const {
      beforeAcc: pluginBeforeAcc = noop,
      before: pluginBefore = noop,
      after: pluginAfter = noop,
      afterAcc: pluginAfterAcc = noop,
    } = getDataFromPlugins(plugin);
    */

    Object.entries(routes)
      .forEach(([routeString, handlerObj]) => {
        const {
          method = baseMethod,
          path = '',
        } = getRoute(routeString);

        const {
          fns,
          before = noop,
          after = noop,
          isRoute = false,
        } = getHandler(handlerObj);

        const newPath = joinPath(basePath, path);

        if (isRoute) {
          return this.applyRoutes(handlerObj, {
            baseMethod: method,
            basePath: newPath,
            baseBefore: [...baseBefore, ...arraify(routeBefore)],
            baseAfter: [...arraify(routeAfter), ...baseAfter],
          });
        }

        this.app[method](newPath, async (req, res) => {
          await this.useFns(this.events.beforeAcc, req, res);

          const acc = {
            raw: {
              req,
              res,
              params: req.params,
              body: req.body,
            },
            meta: {
              path: newPath,
              method,
            },
            data: {
              ...req.params,
              ...req.body,
            },
            get self() { return acc; },
          };


          try {
            await this.useFns(this.events.before, acc);
            await this.useFns(baseBefore, acc);
            await this.useFns(routeBefore, acc);
            await this.useFns(before, acc);
            await this.useFns(fns, acc);
            await this.useFns(after, acc);
            await this.useFns(routeAfter, acc);
            await this.useFns(baseAfter, acc);
            await this.useFns(this.events.after, acc);

            // something needs to have returned by this point
            console.error('ERROR: nothing sent');
            throw {};
          } catch (e) {
            if (e.isBlock) {
              res.send(this.parseData(e.data));

              return;
            }

            const {
              status = 500,
              msg = 'internal server error',
            } = await this.parseError(e);

            res.status(status).send(msg);
          }
        });
      });
  }

  async useFns(maybeFns, acc) {
    const fns = arraify(maybeFns);

    for (const fn of fns) {
      const data = await fn(acc);

      if (data !== undefined) {
        sendBlock(data);
      }
    }
  }

  parseData(data) {
    if (data.raw) {
      return data.raw;
    }

    return JSON.stringify({
      success: true,
      data,
    });
  }
  async parseError(errors) {
    this.callEvent('error', errors);
    if (errors instanceof Error) {
      console.error('ERROR:', errors);
      return {};
    }

    try {
      errors.forEach((error) => {
        if (!this.errors.includes(error.msg)) {
          console.error('ERROR:', error);
          throw new Error(`can't find error message ${error.msg}`);
        }
      });
    } catch (e) {
      return {};
    }


    return {
      status: 400,
      msg: JSON.stringify(errors),
    };
  }
}

const joinPath = (a, b) => path.join(a, b);

const arraify = x => (Array.isArray(x) ? x : [x]);
const sendBlock = (data) => {
  throw {
    isBlock: true,
    data,
  };
};
const getRoute = (str) => {
  const args = str.split(' ');

  switch (args.length) {
    case 1: {
      const [path] = args;
      return {
        path,
      };
    }
    case 2: {
      const [method, path] = args;
      return {
        method,
        path,
      };
    }
    default: {
      throw new Error(`invalid path for "${str}"`);
    }
  }
};

const getHandler = (obj) => {
  const type = getHandlerType(obj);

  switch (type) {
    case 'direct': {
      return {
        fns: obj,
      };
    }
    case 'extended': {
      const {
        before = noop,
        after = noop,
        plugin = [],
        fn,
      } = obj;

      return {
        before,
        after,
        plugin,
        fns: fn,
      };
    }
    case 'route': {
      const {
        before = noop,
        after = noop,
        plugin = [],
        ...routes
      } = obj;

      return {
        isRoute: true,
        before,
        after,
        plugin,
        routes,
      };
    }
  }
};
const getHandlerType = (handler) => {
  if (handler instanceof Function) {
    return 'direct';
  }

  if (handler.fn) {
    return 'extended';
  }

  if (handler.constructor === Object) {
    return 'route';
  }

  throw new Error(`unrecognized handler type for "${handler}"`);
};

module.exports = {
  Conac,
  affirm,
};
