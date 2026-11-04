const notFound = (req, res) =>
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });

const errorHandler = (error, _req, res, _next) => {
  const status = error.status || (
    error.name === 'ValidationError' || error.name === 'CastError'
      ? 400
      : error.code === 11000
        ? 409
        : 500
  );
  if (status >= 500) console.error(error);
  return res.status(status).json({
    success: false,
    message: status >= 500 && process.env.NODE_ENV === 'production'
      ? 'An unexpected server error occurred.'
      : error.message || 'An unexpected server error occurred.',
  });
};

module.exports = { errorHandler, notFound };
