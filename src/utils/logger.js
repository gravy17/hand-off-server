'use strict';

function serialize(value) {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack };
  }
  return value;
}

function write(level, message, fields) {
  const entry = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...(fields ? { ...fields } : {}),
  };

  if (fields && fields.err) {
    entry.err = serialize(fields.err);
  }

  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

const logger = {
  info(message, fields) {
    write('info', message, fields);
  },
  warn(message, fields) {
    write('warn', message, fields);
  },
  error(message, fields) {
    write('error', message, fields);
  },
};

module.exports = { logger };
