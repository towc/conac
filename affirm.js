const makeError = ({ msg, data = {} }) => ({
  msg,
  data,
});

const affirm = (val, msg, data) => {
  if (!val) {
    affirmError({ msg, data });
  }
};
const affirmError = (maybeErrors) => {
  if (maybeErrors) {
    if (Array.isArray(maybeErrors) && maybeErrors.length === 0) {
      return;
    }

    const errors = arraify(maybeErrors);
    throw errors.map(error => makeError(error));
  }
};

const arraify = x => Array.isArray(x) ? x : [x];

module.exports = {
  affirm,
  affirmError,
};
