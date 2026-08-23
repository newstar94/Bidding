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
