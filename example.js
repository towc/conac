const { Conac, affirm } = require('./index.js');

const users = [];
const getUserByName = name => users.find(user => user.name === name);

const validateName = (name) => {
  affirm(typeof name === 'string', 'field bad type', { field: 'name', type: 'string' });
  affirm(name.length < 40, 'name too long');
  affirm(name.length > 3, 'name too short');
};
const validatePassword = (password) => {
  affirm(typeof password === 'string', 'field bad type', { field: 'password', type: 'string' });
  affirm(password.length > 7, 'password too short');
  affirm(password.match(/\d/), 'password missing digit');
  affirm(password.match(/[A-Z]/), 'password missing uppercase');
  affirm(password.match(/[a-z]/), 'password missing lowercase');
};

// not secure, but obscure enough for demo
const hash = str => ((str.split('')
  .reduce((acc, x) => acc + Math.sin(x.codePointAt(0) * acc * str.length), 0.5) / 4) + 0.5).toString(16).split('.')[1];

const ensureHas = arg => ({ data }) => {
  let fields = {};
  if (typeof arg === 'string') {
    fields[arg] = 'any';
  } else if (Array.isArray(arg)) {
    arg.forEach((field) => {
      fields[field] = 'any';
    });
  } else {
    fields = arg;
  }

  Object.entries(fields)
    .forEach(([field, type]) => {
      affirm(data.hasOwnProperty(field), 'field missing', { field });

      if (type !== 'any') {
        affirm(typeof data[field] === type, 'field bad type', { field, type });
      }
    });
};
const autoHash = field => ({ data, self }) => {
  ensureHas({ [field]: 'string' })(self);

  if (!self.hashes) {
    self.hashes = {};
  }

  self.hashes[field] = hash(data[field]);
};
const ensureAuth = ({ data, hashes, self }) => {
  const user = getUserByName(data.name);

  affirm(user, 'invalid user name');
  affirm(user.hash === hashes.password, 'invalid user credentials');

  self.user = user;
};

let i = 0;
const app = new Conac({
  routes: {
    'get /increment': () => i++,
    'post /echo': ({ data }) => data,

    '/user': {
      before: [ensureHas({ name: 'string' }), autoHash('password')],
      'post /create': ({ data }) => {
        validateName(data.name);
        validatePassword(data.password);

        const prevUser = getUserByName(data.name);

        affirm(!prevUser, 'user name already exists');

        const newUser = {
          name: data.name,
          hash: hash(data.password),

          liked: [],
          likedBy: [],
        };

        users.push(newUser);

        return newUser;
      },
      '/': {
        before: [ensureHas(['name', 'password']), ensureAuth],
        'post /like': {
          before: ensureHas('targetName'),
          fn: ({ data, user }) => {
            validateName(data.targetName);

            const targetUser = getUserByName(data.targetName);

            affirm(targetUser, 'invalid target user name');
            affirm(!user.liked.includes(targetUser), 'target user already liked');

            targetUser.likedBy.push(user);
            user.liked.push(targetUser);

            return {
              targetUserLikes: targetUser.likedBy.length,
            };
          },
        },
        'post /delete': ({ user }) => {
          user.liked.forEach((targetUser) => {
            targetUser.likedBy.splice(targetUser.likedBy.indexOf(user), 1);
          });

          user.likedBy.forEach((targetUser) => {
            targetUser.liked.splice(targetUser.liked.indexOf(user), 1);
          });

          return true;
        },
      },
    },

    'get /inspect/:targetName': ({ data }) => {
      const user = getUserByName(data.targetName);
      affirm(user, 'invalid target user name');

      return {
        name: user.name,
        liked: user.liked.map(x => x.name),
        likedBy: user.likedBy.map(x => x.name),
      };
    },

    'get /': () => ({
      raw: `
        <input id=uname placeholder=name value=user><br>
        <input id=psswd placeholder=password value=Password123><br>
        <input id=target placeholder=target_name><br>
        <button id=create>create</button>
        <button id=like>like</button>
        <button id=del>delete</button>
        <button id=inspect>inspect</button>
        <pre id=out></pre>
        <script>
          const log = text => { out.textContent = text + '\\n' + out.textContent };
          const api = (path = '/', method = 'POST', data = {}) => {
            const xhr = new XMLHttpRequest;
            xhr.open(method, path);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify(data));
            xhr.onerror = () => log('ERR: ' + xhr.responseText);
            xhr.onload = () => log('OK: ' + xhr.responseText);
          }

          log('starting');

          const use = path => {
            api(path, 'POST', {
              name: uname.value,
              password: psswd.value,
              targetName: target.value,
            });
          }
          const assoc = (el, path) => el.addEventListener('click', () => use(path));

          assoc(create, '/user/create');
          assoc(like, '/user/like');
          assoc(del, '/user/delete');

          inspect.addEventListener('click', () => {
            api('/inspect/' + target.value, 'GET');
          })
        </script>
      `,
    }),
  },
  events: {
    before: ({ meta }) => {
      console.log(`${meta.method.toUpperCase()} ${meta.path}`);
    },
  },
  errors: [
    'name not string',
    'name too short',
    'name too long',
    'password not string',
    'password too short',
    'password missing digit',
    'password missing uppercase',
    'password missing lowercase',
    'field missing',
    'field bad type',
    'invalid user name',
    'invalid user credentials',
    'user name already exists',
    'invalid target user name',
    'target user already liked',
  ],
});
