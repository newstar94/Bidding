export async function runApplicationBootstrap(
  bootstrap,
  { onSuccess = () => {}, onFailure = () => {} } = {},
) {
  try {
    await bootstrap();
    onSuccess();
    return true;
  } catch (error) {
    onFailure(error);
    return false;
  }
}

export function handleApplicationBootstrapFailure(
  error,
  { recover = () => false, onFailure = () => {} } = {},
) {
  if (recover(error)) return true;
  onFailure(error);
  return false;
}
