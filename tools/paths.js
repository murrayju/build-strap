import path from 'path';

const paths = {
  root: path.resolve(__dirname, '../'),
};

// paths at the root
['src', 'out', 'dist'].forEach((n) => {
  paths[n] = path.join(paths.root, n);
});
paths.distSrc = path.join(paths.dist, 'src');

paths.in = (...args) => path.join(...args);

export default paths;
