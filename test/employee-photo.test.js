import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-photo-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth',
  CLOUDINARY_URL: '',
});

const { employeePhotoUpload } = await import('../src/middleware/employee-photo-upload.js');
const { deleteEmployeePhoto } = await import('../src/services/cloudinary.js');
const { uploadEmployeePhoto } = await import('../src/controllers/employee-controller.js');
const { asyncHandler } = await import('../src/utils/async-handler.js');

const router = express()
  .post('/employees/photo', employeePhotoUpload, asyncHandler(uploadEmployeePhoto))
  .use((error, _req, res, _next) => res.status(error.status ?? 500).json({ code: error.code, message: error.message }));

async function postPhoto(body) {
  const server = router.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/employees/photo`, { method: 'POST', body });
    return { status: response.status, code: (await response.json()).code };
  } finally {
    await new Promise((close) => server.close(close));
  }
}

function formWithPhoto(type, sizeInBytes) {
  const form = new FormData();
  form.append('photo', new File([new Uint8Array(sizeInBytes)], 'photo.jpg', { type }));
  return form;
}

test('a non-image upload is rejected before its bytes reach storage', async () => {
  assert.deepEqual(await postPhoto(formWithPhoto('text/plain', 128)), { status: 415, code: 'EMPLOYEE_PHOTO_TYPE' });
});

test('an oversized upload is rejected with the size limit message', async () => {
  assert.deepEqual(await postPhoto(formWithPhoto('image/jpeg', 6 * 1024 * 1024)), { status: 413, code: 'EMPLOYEE_PHOTO_TOO_LARGE' });
});

test('a missing file field is reported as a client error', async () => {
  const form = new FormData();
  form.append('note', 'no image attached');
  assert.deepEqual(await postPhoto(form), { status: 400, code: 'EMPLOYEE_PHOTO_MISSING' });
});

test('uploads and removals stay inert while photo storage is unconfigured', async () => {
  assert.deepEqual(await postPhoto(formWithPhoto('image/jpeg', 128)), { status: 503, code: 'EMPLOYEE_PHOTO_UNAVAILABLE' });
  await assert.doesNotReject(deleteEmployeePhoto('vam/employees/synthetic-public-id'));
});
